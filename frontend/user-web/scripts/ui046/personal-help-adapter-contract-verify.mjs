import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runPersonalHelp } from "./adapters/personal-help.mjs";
import { persistAreaEvidence } from "./orchestrator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8"));
const runId = "UI046_20260730T100000_personal1", companyId = `${runId}_company`;
const ids = Object.fromEntries(["role", "user", "calendar", "mail", "department", "preference", "notificationPreference"].map((key) => [key, `${runId}_${key}`]));
const SHOTS = ["personal-profile.png", "personal-general-saved.png", "personal-notifications-saved.png", "personal-password-changed.png", "personal-module-links.png", "help-search-category.png", "help-empty.png"].map((name) => `screenshots/${name}`);
const ACTIONS = ["personal.open", "profile.reread", "general.open", "general.save", "general.reread", "notifications.open", "notifications.save", "notifications.reread", "security.open", "password.client-mismatch", "password.change", "password.relogin", "modules.open", "modules.links.visible", "help.open", "help.all", "help.error-search", "help.error-category", "help.empty-search"];
const AUDITS = ["workspace.profile.viewed", "workspace.preferences.viewed", "workspace.preferences.updated", "workspace.preferences.viewed", "workspace.help.viewed", "workspace.help.viewed", "workspace.help.viewed", "workspace.help.viewed", "auth.password.changed"];
const clone = (value) => structuredClone(value);

function ownershipFixture(overrides = {}) { return { runId, companyId, records: [
  { kind: "test_role", id: ids.role, permissions: ["profile:read"], ownerRunId: runId },
  { kind: "test_user", id: ids.user, purpose: "personal-owner", loginId: `${runId.toLowerCase()}_user`, roleId: ids.role, companyId, departmentId: ids.department, active: true, ownerRunId: runId },
  { kind: "user_calendar", id: ids.calendar, userId: ids.user, companyId, isAutoDefault: true, ownerRunId: runId },
  { kind: "mail_account", id: ids.mail, userId: ids.user, companyId, isAutoCreated: true, active: true, ownerRunId: runId },
], precreatedProductRows: 0, referenceDepartment: { id: ids.department, companyId, active: true, existing: true }, helpFingerprintBefore: { count: 6, fingerprint: "help-published-fp" }, ...overrides }; }

function networkFixture() { return [
  { method: "POST", path: "/api/v1/auth/login", status: 200 },
  { method: "GET", path: "/api/v1/workspace/profile", status: 200 },
  { method: "GET", path: "/api/v1/workspace/preferences", status: 200 },
  { method: "GET", path: "/api/v1/notifications/preferences", status: 200 },
  { method: "PUT", path: "/api/v1/workspace/preferences", status: 200 },
  { method: "GET", path: "/api/v1/workspace/preferences", status: 200 },
  { method: "PUT", path: "/api/v1/notifications/preferences", status: 200 },
  { method: "GET", path: "/api/v1/notifications/preferences", status: 200 },
  { method: "POST", path: "/api/v1/auth/change-password", status: 200 },
  { method: "POST", path: "/api/v1/auth/login", status: 200 },
  { method: "GET", path: "/api/v1/workspace/help-policies", status: 200 },
  { method: "GET", path: "/api/v1/workspace/help-policies", status: 200 },
  { method: "GET", path: "/api/v1/workspace/help-policies", status: 200 },
  { method: "GET", path: "/api/v1/workspace/help-policies", status: 200 },
]; }

function browserFixture(overrides = {}) { return { status: "PASS", session: { activeUserId: ids.user, activeLoginId: `${runId.toLowerCase()}_user` }, actions: [...ACTIONS], createdRecords: [
  { kind: "workspace_preference", id: ids.preference, userId: ids.user, createdInBrowser: true, ownerRunId: runId },
  { kind: "notification_preference", id: ids.notificationPreference, userId: ids.user, createdInBrowser: true, ownerRunId: runId },
], profile: { matchesPreparedIdentity: true, readOnly: true, fieldCount: 5 }, general: { locale: "ko-KR", timezone: "Asia/Tokyo", startPage: "files", version: 1, rereadMatches: true }, notifications: { enabled: true, quietHoursEnabled: true, quietHoursStart: "21:30", quietHoursEnd: "06:30", mail: { enabled: true, importantOnly: true }, rereadMatches: true }, password: { clientMismatchRequestCount: 0, changeRequestCount: 1, reloginWithNewPassword: true, secretEvidenceFields: 0 }, modules: { visible: ["mail", "approval", "calendar"], foreignNavigationCount: 0 }, help: { allCount: 6, errorSearchCount: 4, errorCategoryCount: 4, emptyCount: 0, selectedDocumentVisible: true, mutationCount: 0, searchEvidencePersisted: false }, visual: { viewport: "1920x1080", bodyPx: 12, screenTitlePx: 16, sectionTitlePx: 14, helperPx: 10, infoTooltip: true }, network: networkFixture(), mutationOwnership: [
  { kind: "workspace_preference", id: ids.preference, method: "PUT", path: "/api/v1/workspace/preferences" },
  { kind: "notification_preference", id: ids.notificationPreference, method: "PUT", path: "/api/v1/notifications/preferences" },
  { kind: "test_user", id: ids.user, method: "POST", path: "/api/v1/auth/change-password" },
], screenshots: SHOTS, ...overrides }; }

function auditRows() { return AUDITS.map((event) => ({ event, actorId: ids.user, targetId: ids.user, ownerRunId: runId, reasonSafe: true })); }
function dbFixture(records, overrides = {}) { return { rows: records.filter((row) => ["workspace_preference", "notification_preference"].includes(row.kind)).map((row) => ({ kind: row.kind, id: row.id, userId: ids.user, ownerRunId: runId })), preference: { userId: ids.user, companyId, locale: "ko-KR", timezone: "Asia/Tokyo", startPage: "files", version: 1 }, notificationPreference: { userId: ids.user, enabled: true, quietHoursEnabled: true, quietHoursStart: "21:30", quietHoursEnd: "06:30", mail: { enabled: true, importantOnly: true } }, helpFingerprint: { before: "help-published-fp", after: "help-published-fp", beforeCount: 6, afterCount: 6 }, audits: auditRows(), notificationAudits: [{ event: "notification.preferences.updated", actorId: ids.user, targetId: ids.user, ownerRunId: runId, reasonSafe: true }], existingRowChanges: 0, ...overrides }; }
function fp(id, exists = true) { return exists ? { id, before: { exists: true, fingerprint: `${id}_fp` }, after: { exists: true, fingerprint: `${id}_fp` } } : { id, before: { exists: false }, after: { exists: false } }; }
function cleanupFixture(records, overrides = {}) { return { runId, approved: true, residualOwnedRows: 0, residualOwnedAudit: 0, sessionsClosed: true, disposableIdentities: records.filter((row) => ["test_role", "test_user"].includes(row.kind)).map((row) => ({ kind: row.kind, id: row.id, ownerRunId: runId, active: false })), disposableMailAccounts: [{ id: ids.mail, userId: ids.user, ownerRunId: runId, active: false }], protectedAccounts: [fp("admin"), fp("cyhuh", false), fp("ysla", false)], referenceDepartment: fp(ids.department), existingPreferencesFingerprint: { before: "preferences-fp", after: "preferences-fp" }, existingNotificationsFingerprint: { before: "notifications-fp", after: "notifications-fp" }, helpFingerprint: { before: "help-published-fp", after: "help-published-fp" }, ...overrides }; }

function drivers(overrides = {}) { const base = overrides.ownership ?? ownershipFixture(); let close = false, cleanup = false; return { browserDriver: { async runPersonalHelpFlow() { if (overrides.primaryError) throw new Error("primary"); return overrides.browser ?? browserFixture(); }, async close() { close = true; } }, dbDriver: { async prepareOwnedData() { return base; }, async collectPersonalHelpEvidence({ ownership }) { return overrides.db ?? dbFixture(ownership.records); }, async cleanupOwnedData({ ownership }) { cleanup = true; if (overrides.cleanupError) throw new Error("cleanup"); return overrides.cleanup ?? cleanupFixture(ownership.records); } }, closeCalled: () => close, cleanupCalled: () => cleanup }; }
async function expectCode(code, setup, cleanupApproved = true) { await assert.rejects(runPersonalHelp({ manifest, runId, evidenceDir: "contract-evidence", cleanupApproved, ...setup }), (error) => String(error?.code ?? "").split(":", 1)[0] === code); }

const checks = [];
assert.equal(manifest.areas.find((area) => area.id === "personal-help")?.status, "READY"); assert.equal(manifest.areas.find((area) => area.id === "personal-help")?.adapter, "personal-help"); checks.push("personal help READY contract");
await expectCode("LIVE_INPUT_REQUIRED", {}); checks.push("missing drivers");
const missing = drivers(); delete missing.browserDriver.runPersonalHelpFlow; await expectCode("LIVE_INPUT_REQUIRED", missing); checks.push("missing browser method");
const valid = drivers(); const result = await runPersonalHelp({ manifest, runId, evidenceDir: "contract-evidence", cleanupApproved: true, browserDriver: valid.browserDriver, dbDriver: valid.dbDriver }); assert.equal(result.status, "PASS"); assert.equal(valid.closeCalled(), true); assert.equal(valid.cleanupCalled(), true); checks.push("valid composite");
const noPermission = ownershipFixture(); noPermission.records[0].permissions = []; await expectCode("IDENTITY_TOPOLOGY_INVALID", drivers({ ownership: noPermission })); checks.push("profile read required");
const extraPermission = ownershipFixture(); extraPermission.records[0].permissions.push("workspace:write"); await expectCode("IDENTITY_TOPOLOGY_INVALID", drivers({ ownership: extraPermission })); checks.push("minimal permission");
const precreated = ownershipFixture({ precreatedProductRows: 1 }); await expectCode("PRECREATED_PRODUCT_ROW_REJECTED", drivers({ ownership: precreated })); checks.push("no precreated settings row");
const protectedSession = browserFixture(); protectedSession.session.activeLoginId = "admin"; await expectCode("PROTECTED_ACCOUNT_SESSION_REJECTED", drivers({ browser: protectedSession })); checks.push("protected session");
const missingAction = browserFixture(); missingAction.actions.pop(); await expectCode("ACTION_EVIDENCE_INCOMPLETE", drivers({ browser: missingAction })); checks.push("actions complete");
const badProfile = browserFixture(); badProfile.profile.readOnly = false; await expectCode("PROFILE_CONTRACT_INVALID", drivers({ browser: badProfile })); checks.push("profile readonly");
const badGeneral = browserFixture(); badGeneral.general.timezone = "Asia/Seoul"; await expectCode("GENERAL_PREFERENCES_INVALID", drivers({ browser: badGeneral })); checks.push("general persisted values");
const badNotification = browserFixture(); badNotification.notifications.mail.importantOnly = false; await expectCode("NOTIFICATION_PREFERENCES_INVALID", drivers({ browser: badNotification })); checks.push("notifications persisted values");
const mismatchNetwork = browserFixture(); mismatchNetwork.password.clientMismatchRequestCount = 1; await expectCode("PASSWORD_FLOW_INVALID", drivers({ browser: mismatchNetwork })); checks.push("client mismatch no network");
const noRelogin = browserFixture(); noRelogin.password.reloginWithNewPassword = false; await expectCode("PASSWORD_FLOW_INVALID", drivers({ browser: noRelogin })); checks.push("password relogin");
const badModules = browserFixture(); badModules.modules.visible.pop(); await expectCode("MODULE_LINKS_INVALID", drivers({ browser: badModules })); checks.push("module links visible");
const helpMutation = browserFixture(); helpMutation.help.mutationCount = 1; await expectCode("HELP_CONTRACT_INVALID", drivers({ browser: helpMutation })); checks.push("help read only");
const persistedSearch = browserFixture(); persistedSearch.help.searchEvidencePersisted = true; await expectCode("HELP_CONTRACT_INVALID", drivers({ browser: persistedSearch })); checks.push("help search not persisted");
const badVisual = browserFixture(); badVisual.visual.bodyPx = 14; await expectCode("VISUAL_CONTRACT_INVALID", drivers({ browser: badVisual })); checks.push("visual standard");
const query = browserFixture(); query.network[10].path += "?query=ERROR"; await expectCode("NETWORK_NOT_SAME_ORIGIN_RELATIVE", drivers({ browser: query })); checks.push("query rejected");
const absolute = browserFixture(); absolute.network[1].path = "https://outside.invalid/api/v1/workspace/profile"; await expectCode("NETWORK_NOT_SAME_ORIGIN_RELATIVE", drivers({ browser: absolute })); checks.push("absolute rejected");
const extraPassword = browserFixture(); extraPassword.network.push({ method: "POST", path: "/api/v1/auth/change-password", status: 200 }); await expectCode("NETWORK_ROUTE_CARDINALITY_INVALID", drivers({ browser: extraPassword })); checks.push("password network exact one");
const missingHelp = browserFixture(); missingHelp.network.pop(); await expectCode("NETWORK_ROUTE_CARDINALITY_INVALID", drivers({ browser: missingHelp })); checks.push("help network exact four");
const secret = browserFixture(); secret.password.token = "forbidden"; await expectCode("SENSITIVE_FIELD_REJECTED", drivers({ browser: secret })); checks.push("secret field rejected");
const wrongPreference = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); wrongPreference.preference.version = 0; await expectCode("DB_PREFERENCES_INVALID", drivers({ db: wrongPreference })); checks.push("DB preference version");
const wrongNotification = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); wrongNotification.notificationPreference.quietHoursEnd = "07:00"; await expectCode("DB_NOTIFICATION_INVALID", drivers({ db: wrongNotification })); checks.push("DB notification state");
const helpChanged = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); helpChanged.helpFingerprint.after = "changed"; await expectCode("HELP_FINGERPRINT_CHANGED", drivers({ db: helpChanged })); checks.push("help fingerprint unchanged");
const missingAudit = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); missingAudit.audits.pop(); await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: missingAudit })); checks.push("workspace audit cardinality");
const badActor = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); badActor.audits[0].actorId = "foreign"; await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: badActor })); checks.push("audit actor target");
const missingNotificationAudit = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); missingNotificationAudit.notificationAudits = []; await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: missingNotificationAudit })); checks.push("notification audit cardinality");
const unsafeReason = dbFixture([...ownershipFixture().records, ...browserFixture().createdRecords]); unsafeReason.audits[4].reasonSafe = false; await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: unsafeReason })); checks.push("audit reason safe");
const approvalGate = drivers(); await expectCode("CLEANUP_APPROVAL_REQUIRED", approvalGate, false); assert.equal(approvalGate.closeCalled(), true); assert.equal(approvalGate.cleanupCalled(), false); checks.push("cleanup approval gate");
await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: cleanupFixture(ownershipFixture().records, { residualOwnedRows: 1 }) })); checks.push("cleanup residual");
const activeIdentity = cleanupFixture(ownershipFixture().records); activeIdentity.disposableIdentities[0].active = true; await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: activeIdentity })); checks.push("identities inactive");
const activeMail = cleanupFixture(ownershipFixture().records); activeMail.disposableMailAccounts[0].active = true; await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: activeMail })); checks.push("mail inactive");
const protectedChanged = cleanupFixture(ownershipFixture().records); protectedChanged.protectedAccounts[0].after.fingerprint = "changed"; await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: protectedChanged })); checks.push("protected fingerprints");
const cleanupPriority = drivers({ primaryError: true, cleanupError: true }); await expectCode("CLEANUP_FAILED", cleanupPriority); assert.equal(cleanupPriority.closeCalled(), true); assert.equal(cleanupPriority.cleanupCalled(), true); checks.push("cleanup error priority");
const temp = await mkdtemp(resolve(tmpdir(), "ui046-personal-help-")); try { await mkdir(resolve(temp, "screenshots")); for (const shot of SHOTS) await writeFile(resolve(temp, shot), "png"); await persistAreaEvidence({ result, directory: temp, selectedAreaId: "personal-help", selectedRunId: runId }); checks.push("seven screenshots and six evidence files"); } finally { await rm(temp, { recursive: true, force: true }); }
const guard = spawnSync(process.execPath, [resolve(here, "orchestrator.mjs"), "execute-area", "--area=personal-help", `--run-id=${runId}`], { encoding: "utf8" }); assert.equal(guard.status, 2); assert.match(guard.stderr, /LIVE_INPUT_REQUIRED/); checks.push("orchestrator live input guard");
console.log(JSON.stringify({ status: "PASS", passed: checks.length, total: checks.length, checks }));
