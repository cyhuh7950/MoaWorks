import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runAddressOrganization } from "./adapters/address-organization.mjs";
import { persistAreaEvidence } from "./orchestrator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8"));
const runId = "UI046_20260729T210000_addr1", companyId = `${runId}_company`;
const ids = Object.fromEntries(["role", "owner", "target", "ownerCalendar", "targetCalendar", "department", "group", "manualContact", "importedContact"].map((key) => [key, `${runId}_${key}`]));
const SHOTS = ["address-personal-list.png", "address-contact-form.png", "address-import-preview.png", "address-public-search.png", "organization-tree.png", "organization-detail.png", "organization-picker.png"].map((name) => `screenshots/${name}`);
const AUDITS = ["workspace.contact_group.created", "workspace.contact_group.updated", "workspace.contact_group.deleted", "workspace.contact.created", "workspace.contact.updated", "workspace.contact.deleted", "workspace.contact.deleted", "workspace.contact.imported", "workspace.organization.member_viewed", "workspace.organization.member_viewed"];
const clone = (value) => structuredClone(value);

function ownershipFixture(overrides = {}) { return { runId, companyId, records: [
  { kind: "test_role", id: ids.role, permissions: ["profile:read"], ownerRunId: runId },
  { kind: "test_user", id: ids.owner, purpose: "owner", roleId: ids.role, companyId, departmentId: ids.department, active: true, identityIncludesRunId: true, ownerRunId: runId },
  { kind: "test_user", id: ids.target, purpose: "directory-target", roleId: ids.role, companyId, departmentId: ids.department, active: true, identityIncludesRunId: true, ownerRunId: runId },
  { kind: "user_calendar", id: ids.ownerCalendar, userId: ids.owner, companyId, isAutoDefault: true, ownerRunId: runId },
  { kind: "user_calendar", id: ids.targetCalendar, userId: ids.target, companyId, isAutoDefault: true, ownerRunId: runId },
], referenceDepartment: { id: ids.department, companyId, active: true, existing: true }, ...overrides }; }

function addressFixture(overrides = {}) { return { status: "PASS", session: { activeUserId: ids.owner, activeLoginId: `${runId.toLowerCase()}_owner` }, actions: ["address.open", "address.personal.scope", "address.three-pane", "group.create", "group.rename", "contact.create", "contact.search", "contact.select", "contact.detail.reread", "contact.update", "address.public.scope", "public.search", "public.readonly", "csv.select", "csv.preview", "csv.apply", "csv.contact.reread", "contact.manual.delete", "contact.imported.delete", "group.delete"], createdRecords: [
  { kind: "contact_group", id: ids.group, ownerUserId: ids.owner, companyId, createdInBrowser: true, ownerRunId: runId },
  { kind: "personal_contact", id: ids.manualContact, source: "manual", groupId: ids.group, ownerUserId: ids.owner, companyId, createdInBrowser: true, ownerRunId: runId },
  { kind: "personal_contact", id: ids.importedContact, source: "csv", groupId: ids.group, ownerUserId: ids.owner, companyId, createdInBrowser: true, ownerRunId: runId },
], states: { groupCreated: true, groupRenamed: true, groupDeleted: true, manualCreated: true, manualUpdated: true, manualDeleted: true, importedReread: true, importedDeleted: true, activeListResidual: 0 }, publicContact: { userId: ids.target, companyId, departmentId: ids.department, roleId: ids.role, active: true, matchesRunIdentity: true, editVisible: false, deleteVisible: false }, csv: { previewCount: 1, applyCount: 1, digestMatches: true, digestPrefixPresent: true, newCount: 1, errorCount: 0, canApply: true, groupId: ids.group, importedContactId: ids.importedContact, implicitGroupCreated: false, importedReread: true }, network: [
  { method: "GET", path: "/api/v1/workspace/contact-groups", status: 200 }, { method: "GET", path: "/api/v1/workspace/contacts", status: 200 },
  { method: "POST", path: "/api/v1/workspace/contact-groups", status: 201 }, { method: "PATCH", path: `/api/v1/workspace/contact-groups/${ids.group}`, status: 200 },
  { method: "POST", path: "/api/v1/workspace/contacts", status: 201 }, { method: "PATCH", path: `/api/v1/workspace/contacts/${ids.manualContact}`, status: 200 },
  { method: "GET", path: "/api/v1/workspace/public-contacts", status: 200 }, { method: "POST", path: "/api/v1/workspace/contacts/import", status: 200 }, { method: "POST", path: "/api/v1/workspace/contacts/import", status: 201 },
  { method: "DELETE", path: `/api/v1/workspace/contacts/${ids.manualContact}`, status: 204 }, { method: "DELETE", path: `/api/v1/workspace/contacts/${ids.importedContact}`, status: 204 }, { method: "DELETE", path: `/api/v1/workspace/contact-groups/${ids.group}`, status: 204 },
], mutationOwnership: [
  { kind: "contact_group", id: ids.group, method: "POST", path: "/api/v1/workspace/contact-groups" }, { kind: "contact_group", id: ids.group, method: "PATCH", path: `/api/v1/workspace/contact-groups/${ids.group}` },
  { kind: "personal_contact", id: ids.manualContact, method: "POST", path: "/api/v1/workspace/contacts" }, { kind: "personal_contact", id: ids.manualContact, method: "PATCH", path: `/api/v1/workspace/contacts/${ids.manualContact}` },
  { kind: "contact_import", id: ids.group, phase: "preview", method: "POST", path: "/api/v1/workspace/contacts/import" }, { kind: "contact_import", id: ids.importedContact, groupId: ids.group, phase: "apply", method: "POST", path: "/api/v1/workspace/contacts/import" },
  { kind: "personal_contact", id: ids.manualContact, method: "DELETE", path: `/api/v1/workspace/contacts/${ids.manualContact}` }, { kind: "personal_contact", id: ids.importedContact, method: "DELETE", path: `/api/v1/workspace/contacts/${ids.importedContact}` }, { kind: "contact_group", id: ids.group, method: "DELETE", path: `/api/v1/workspace/contact-groups/${ids.group}` },
], screenshots: SHOTS.slice(0, 4), ...overrides }; }

function organizationFixture(overrides = {}) { return { status: "PASS", session: { activeUserId: ids.owner, activeLoginId: `${runId.toLowerCase()}_owner` }, actions: ["organization.open", "organization.three-column", "department.select", "department.members.reread", "organization.search", "organization.detail.select", "organization.detail.reread", "picker.open", "picker.department", "picker.search", "picker.radio.select", "picker.confirm"], department: { id: ids.department, companyId, active: true, existing: true, mutationCount: 0 }, target: { userId: ids.target, companyId, departmentId: ids.department, roleId: ids.role, active: true, matchesPublicContact: true, matchesRunIdentity: true }, picker: { selectionMode: "single", selectedUserId: ids.target, confirmed: true, multiSelect: false }, network: [
  { method: "GET", path: "/api/v1/workspace/organization/departments", status: 200 }, { method: "GET", path: "/api/v1/workspace/organization/members", status: 200 }, { method: "GET", path: "/api/v1/workspace/organization/members", status: 200 }, { method: "GET", path: `/api/v1/workspace/organization/members/${ids.target}`, status: 200 },
], mutationOwnership: [], screenshots: SHOTS.slice(4), ...overrides }; }

function repeatedOrganizationFixture() { const fixture = organizationFixture(); fixture.network.push(
  { method: "GET", path: "/api/v1/workspace/organization/departments", status: 200 },
  { method: "GET", path: "/api/v1/workspace/organization/members", status: 200 },
  { method: "GET", path: "/api/v1/workspace/organization/members", status: 200 },
  { method: "GET", path: `/api/v1/workspace/organization/members/${ids.target}`, status: 200 },
); return fixture; }

function auditRows() { const targets = [ids.group, ids.group, ids.group, ids.manualContact, ids.manualContact, ids.manualContact, ids.importedContact, ids.owner, ids.target, ids.target]; return AUDITS.map((event, index) => ({ event, actorId: ids.owner, targetId: targets[index], reasonSafe: true, ownerRunId: runId })); }
function dbFixture(records, overrides = {}) { return { rows: records.filter((x) => ["contact_group", "personal_contact"].includes(x.kind)).map((x) => ({ kind: x.kind, id: x.id, ownerRunId: runId })), group: { id: ids.group, ownerUserId: ids.owner, companyId, deleted: true }, contacts: [{ id: ids.manualContact, source: "manual", groupId: ids.group, ownerUserId: ids.owner, companyId, deleted: true }, { id: ids.importedContact, source: "csv", groupId: ids.group, ownerUserId: ids.owner, companyId, deleted: true }], directory: { publicUserId: ids.target, organizationUserId: ids.target, companyId, departmentId: ids.department, roleId: ids.role, active: true }, audits: auditRows(), existingRowChanges: 0, ...overrides }; }
function ownerImportedAuditFixture(records) { const fixture = dbFixture(records); fixture.audits[7].targetId = ids.owner; return fixture; }
function fp(id, exists = true) { return exists ? { id, before: { exists: true, fingerprint: `${id}_fp` }, after: { exists: true, fingerprint: `${id}_fp` } } : { id, before: { exists: false }, after: { exists: false } }; }
function cleanupFixture(records, overrides = {}) { return { runId, residualOwnedRows: 0, residualOwnedAudit: 0, sessionsClosed: true, existingRowChanges: 0, disposableIdentities: records.filter((x) => ["test_role", "test_user"].includes(x.kind)).map((x) => ({ kind: x.kind, id: x.id, ownerRunId: runId, active: false })), protectedAccounts: [fp("admin"), fp("cyhuh", false), fp("ysla", false)], referenceDepartment: fp(ids.department), existingAddressOrganizationFingerprint: { before: "addr_org_fp", after: "addr_org_fp" }, ...overrides }; }

function drivers(overrides = {}) { const base = overrides.ownership ?? ownershipFixture(); const dynamic = [...base.records, ...addressFixture().createdRecords]; let close = false, cleanup = false; return { browserDriver: { async runAddressBookFlow() { if (overrides.primaryError) throw new Error("primary"); return overrides.address ?? addressFixture(); }, async runOrganizationFlow() { return overrides.organization ?? organizationFixture(); }, async close() { close = true; } }, dbDriver: { async prepareOwnedData() { return base; }, async collectAddressOrganizationEvidence({ ownership }) { return overrides.db ?? dbFixture(ownership.records); }, async cleanupOwnedData({ ownership }) { cleanup = true; if (overrides.cleanupError) throw new Error("cleanup"); return overrides.cleanup ?? cleanupFixture(ownership?.records ?? dynamic); } }, closeCalled: () => close, cleanupCalled: () => cleanup }; }
async function expectCode(code, setup) { await assert.rejects(runAddressOrganization({ manifest, runId, evidenceDir: "contract-evidence", ...setup }), (error) => String(error?.code ?? "").split(":", 1)[0] === code); }

const checks = [];
const remediationRecords = [...ownershipFixture().records, ...addressFixture().createdRecords];
const remediationResults = await Promise.allSettled([
  runAddressOrganization({ manifest, runId, evidenceDir: "contract-evidence", ...drivers({ organization: repeatedOrganizationFixture() }) }),
  runAddressOrganization({ manifest, runId, evidenceDir: "contract-evidence", ...drivers({ db: ownerImportedAuditFixture(remediationRecords) }) }),
]);
assert.deepEqual(remediationResults.map((item) => item.status === "fulfilled" ? "PASS" : item.reason?.code), ["PASS", "PASS"]);
checks.push("organization GET repetitions preserved", "imported audit targets owner");
assert.equal(manifest.areas.find((x) => x.id === "address-organization")?.status, "READY"); assert.equal(manifest.areas.find((x) => x.id === "address-organization")?.adapter, "address-organization"); checks.push("address organization READY contract");
await expectCode("LIVE_INPUT_REQUIRED", {}); checks.push("missing drivers");
const missing = drivers(); delete missing.browserDriver.runOrganizationFlow; await expectCode("LIVE_INPUT_REQUIRED", missing); checks.push("missing browser method");
const valid = drivers(); const result = await runAddressOrganization({ manifest, runId, evidenceDir: "contract-evidence", browserDriver: valid.browserDriver, dbDriver: valid.dbDriver }); assert.equal(result.status, "PASS"); assert.equal(valid.closeCalled(), true); assert.equal(valid.cleanupCalled(), true); checks.push("valid composite");
const missingPermission = ownershipFixture(); missingPermission.records[0].permissions = []; await expectCode("IDENTITY_TOPOLOGY_INVALID", drivers({ ownership: missingPermission })); checks.push("profile read required");
const extraPermission = ownershipFixture(); extraPermission.records[0].permissions.push("contact:write"); await expectCode("IDENTITY_TOPOLOGY_INVALID", drivers({ ownership: extraPermission })); checks.push("minimal permission");
const precreated = ownershipFixture(); precreated.records.push({ kind: "contact_group", id: ids.group, ownerRunId: runId }); await expectCode("PRECREATED_PRODUCT_ROW_REJECTED", drivers({ ownership: precreated })); checks.push("no precreated product row");
const protectedSession = addressFixture(); protectedSession.session.activeLoginId = "admin"; await expectCode("PROTECTED_ACCOUNT_SESSION_REJECTED", drivers({ address: protectedSession })); checks.push("protected session");
const protectedTarget = organizationFixture(); protectedTarget.target.userId = "cyhuh"; await expectCode("PROTECTED_TARGET_REJECTED", drivers({ organization: protectedTarget })); checks.push("protected target");
const foreignCompany = addressFixture(); foreignCompany.publicContact.companyId = "foreign"; await expectCode("DYNAMIC_RELATION_INVALID", drivers({ address: foreignCompany })); checks.push("foreign company");
const foreignGroup = addressFixture(); foreignGroup.mutationOwnership[1].id = "foreign"; await expectCode("NETWORK_DYNAMIC_OWNERSHIP_MISMATCH", drivers({ address: foreignGroup })); checks.push("foreign group mutation");
const foreignContact = addressFixture(); foreignContact.network[9].path = "/api/v1/workspace/contacts/foreign"; await expectCode("NETWORK_DYNAMIC_OWNERSHIP_MISMATCH", drivers({ address: foreignContact })); checks.push("foreign contact mutation");
const query = addressFixture(); query.network[0].path += "?q=x"; await expectCode("NETWORK_NOT_SAME_ORIGIN_RELATIVE", drivers({ address: query })); checks.push("query rejected");
const absolute = organizationFixture(); absolute.network[0].path = "https://outside.invalid/api"; await expectCode("NETWORK_NOT_SAME_ORIGIN_RELATIVE", drivers({ organization: absolute })); checks.push("absolute rejected");
const omittedMutation = addressFixture(); omittedMutation.mutationOwnership.pop(); await expectCode("MUTATION_EVIDENCE_INCOMPLETE", drivers({ address: omittedMutation })); checks.push("mutation omission");
const duplicatedMutation = addressFixture(); duplicatedMutation.mutationOwnership.push(clone(duplicatedMutation.mutationOwnership[0])); await expectCode("MUTATION_EVIDENCE_INCOMPLETE", drivers({ address: duplicatedMutation })); checks.push("mutation duplication");
const badDigest = addressFixture(); badDigest.csv.digestMatches = false; await expectCode("CSV_CONTRACT_INVALID", drivers({ address: badDigest })); checks.push("csv digest");
const badCsvCount = addressFixture(); badCsvCount.csv.errorCount = 1; await expectCode("CSV_CONTRACT_INVALID", drivers({ address: badCsvCount })); checks.push("csv count");
const implicitGroup = addressFixture(); implicitGroup.csv.implicitGroupCreated = true; await expectCode("CSV_CONTRACT_INVALID", drivers({ address: implicitGroup })); checks.push("csv existing group only");
const mixedAddress = addressFixture(); mixedAddress.actions.push("organization.detail.select"); await expectCode("FLOW_BOUNDARY_INVALID", drivers({ address: mixedAddress })); checks.push("address organization actions separated");
const organizationMutation = organizationFixture(); organizationMutation.network.push({ method: "PATCH", path: `/api/v1/workspace/organization/members/${ids.target}`, status: 200 }); organizationMutation.mutationOwnership.push({ kind: "test_user", id: ids.target, method: "PATCH", path: `/api/v1/workspace/organization/members/${ids.target}` }); await expectCode("ORGANIZATION_MUTATION_REJECTED", drivers({ organization: organizationMutation })); checks.push("organization read only");
const missingDepartments = organizationFixture(); missingDepartments.network = missingDepartments.network.filter((x) => x.path !== "/api/v1/workspace/organization/departments"); await expectCode("NETWORK_ROUTE_FAMILY_INCOMPLETE", drivers({ organization: missingDepartments })); checks.push("departments GET minimum");
const insufficientMembers = organizationFixture(); insufficientMembers.network.splice(insufficientMembers.network.findIndex((x) => x.path === "/api/v1/workspace/organization/members"), 1); await expectCode("NETWORK_ROUTE_FAMILY_INCOMPLETE", drivers({ organization: insufficientMembers })); checks.push("members GET minimum");
const missingTargetDetail = organizationFixture(); missingTargetDetail.network = missingTargetDetail.network.filter((x) => x.path !== `/api/v1/workspace/organization/members/${ids.target}`); await expectCode("NETWORK_ROUTE_FAMILY_INCOMPLETE", drivers({ organization: missingTargetDetail })); checks.push("target detail GET minimum");
const wrongRelation = dbFixture([...ownershipFixture().records, ...addressFixture().createdRecords]); wrongRelation.contacts[1].groupId = "foreign"; await expectCode("DYNAMIC_RELATION_INVALID", drivers({ db: wrongRelation })); checks.push("DB relation");
const records = [...ownershipFixture().records, ...addressFixture().createdRecords];
const missingAudit = dbFixture(records); missingAudit.audits.pop(); await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: missingAudit })); checks.push("audit cardinality");
const extraMemberViewed = dbFixture(records); extraMemberViewed.audits.push(clone(extraMemberViewed.audits.at(-1))); await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: extraMemberViewed })); checks.push("member viewed exact two");
const reorderedAudit = dbFixture(records); [reorderedAudit.audits[0], reorderedAudit.audits[1]] = [reorderedAudit.audits[1], reorderedAudit.audits[0]]; await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: reorderedAudit })); checks.push("audit ordering");
const badActor = dbFixture(records); badActor.audits[0].actorId = ids.target; await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: badActor })); checks.push("audit actor");
const badTarget = dbFixture(records); badTarget.audits[8].targetId = ids.group; await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: badTarget })); checks.push("audit target");
const piiAudit = dbFixture(records); piiAudit.audits[0].contactName = "forbidden"; await expectCode("PII_EVIDENCE_REJECTED", drivers({ db: piiAudit })); checks.push("audit PII rejected");
await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: cleanupFixture(ownershipFixture().records, { residualOwnedRows: 1 }) })); checks.push("cleanup residual");
const badIdentityCleanup = cleanupFixture(ownershipFixture().records); badIdentityCleanup.disposableIdentities[0].active = true; await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: badIdentityCleanup })); checks.push("identities inactive");
const protectedChanged = cleanupFixture(ownershipFixture().records); protectedChanged.protectedAccounts[0].after.fingerprint = "changed"; await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: protectedChanged })); checks.push("protected fingerprints");
const cleanupPriority = drivers({ primaryError: true, cleanupError: true }); await expectCode("CLEANUP_FAILED", cleanupPriority); assert.equal(cleanupPriority.closeCalled(), true); assert.equal(cleanupPriority.cleanupCalled(), true); checks.push("cleanup error priority");
const temp = await mkdtemp(resolve(tmpdir(), "ui046-address-org-")); try { await mkdir(resolve(temp, "screenshots")); for (const shot of SHOTS) await writeFile(resolve(temp, shot), "png"); await persistAreaEvidence({ result, directory: temp, selectedAreaId: "address-organization", selectedRunId: runId }); checks.push("seven screenshots and six evidence files"); } finally { await rm(temp, { recursive: true, force: true }); }
const guard = spawnSync(process.execPath, [resolve(here, "orchestrator.mjs"), "execute-area", "--area=address-organization", `--run-id=${runId}`], { encoding: "utf8" }); assert.equal(guard.status, 2); assert.match(guard.stderr, /LIVE_INPUT_REQUIRED/); checks.push("orchestrator live input guard");
console.log(JSON.stringify({ status: "PASS", passed: checks.length, total: checks.length, checks }));
