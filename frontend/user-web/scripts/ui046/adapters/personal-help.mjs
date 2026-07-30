const METHODS = { browser: ["runPersonalHelpFlow", "close"], db: ["prepareOwnedData", "collectPersonalHelpEvidence", "cleanupOwnedData"] };
const PROTECTED = new Set(["admin", "cyhuh", "ysla"]);
const SENSITIVE = /password|hash|token|cookie|authorization|secret|set-cookie|query|searchtext|requestbody|responsebody/i;
const SHOTS = ["personal-profile.png", "personal-general-saved.png", "personal-notifications-saved.png", "personal-password-changed.png", "personal-module-links.png", "help-search-category.png", "help-empty.png"].map((name) => `screenshots/${name}`);
const ACTIONS = ["personal.open", "profile.reread", "general.open", "general.save", "general.reread", "notifications.open", "notifications.save", "notifications.reread", "security.open", "password.client-mismatch", "password.change", "password.relogin", "modules.open", "modules.links.visible", "help.open", "help.all", "help.error-search", "help.error-category", "help.empty-search"];
const ROUTE_COUNTS = new Map([
  ["POST /api/v1/auth/login", 2], ["GET /api/v1/workspace/profile", 5], ["GET /api/v1/workspace/preferences", 8],
  ["GET /api/v1/notifications/preferences", 5], ["PUT /api/v1/workspace/preferences", 1], ["PUT /api/v1/notifications/preferences", 2],
  ["POST /api/v1/auth/change-password", 1], ["GET /api/v1/workspace/help-policies", 4],
]);
const AUDIT_COUNTS = new Map([
  ["workspace.profile.viewed", 5], ["workspace.preferences.viewed", 8], ["workspace.preferences.updated", 1],
  ["workspace.help.viewed", 4], ["auth.password.changed", 1],
]);

function fail(code) { const error = new Error(code); error.code = code; return error; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function stable(item) { return item?.before?.exists === item?.after?.exists && (!item?.before?.exists || item.before.fingerprint === item.after.fingerprint); }
function scan(value, at = "personal-help") { if (!value || typeof value !== "object") return; for (const [key, item] of Object.entries(value)) { if (SENSITIVE.test(key)) throw fail(`SENSITIVE_FIELD_REJECTED:${at}.${key}`); if (item && typeof item === "object") scan(item, `${at}.${key}`); } }
function counts(items, keyOf) { const result = new Map(); for (const item of items) { const key = keyOf(item); result.set(key, (result.get(key) ?? 0) + 1); } return result; }
function sameCounts(actual, expected) { if (actual.size !== expected.size) return false; for (const [key, value] of expected) if (actual.get(key) !== value) return false; return true; }
function assertDrivers(browser, db) { if (!browser || !db) throw fail("LIVE_INPUT_REQUIRED"); scan(browser); scan(db); for (const name of METHODS.browser) if (typeof browser[name] !== "function") throw fail("LIVE_INPUT_REQUIRED"); for (const name of METHODS.db) if (typeof db[name] !== "function") throw fail("LIVE_INPUT_REQUIRED"); }

function assertBase(value, runId) {
  scan(value);
  if (value?.runId !== runId || !value.companyId || !Array.isArray(value.records) || value.precreatedProductRows !== 0) throw fail(value?.precreatedProductRows ? "PRECREATED_PRODUCT_ROW_REJECTED" : "OWNERSHIP_CONTRACT_INVALID");
  const allowed = new Set(["test_role", "test_user", "user_calendar", "mail_account"]);
  if (value.records.some((row) => !allowed.has(row.kind) || row.ownerRunId !== runId) || new Set(value.records.map((row) => row.id)).size !== value.records.length) throw fail("PRECREATED_PRODUCT_ROW_REJECTED");
  const role = value.records.find((row) => row.kind === "test_role"), user = value.records.find((row) => row.kind === "test_user"), calendar = value.records.find((row) => row.kind === "user_calendar"), mail = value.records.find((row) => row.kind === "mail_account");
  if (value.records.filter((row) => row.kind === "test_role").length !== 1 || value.records.filter((row) => row.kind === "test_user").length !== 1 || value.records.filter((row) => row.kind === "user_calendar").length !== 1 || value.records.filter((row) => row.kind === "mail_account").length !== 1 || !same(role?.permissions, ["profile:read"])) throw fail("IDENTITY_TOPOLOGY_INVALID");
  const login = String(user?.loginId ?? "").toLowerCase();
  if (PROTECTED.has(login) || !login.includes(runId.toLowerCase()) || user?.purpose !== "personal-owner" || user.roleId !== role.id || user.companyId !== value.companyId || user.departmentId !== value.referenceDepartment?.id || !user.active || !value.referenceDepartment?.existing || !value.referenceDepartment?.active || value.referenceDepartment.companyId !== value.companyId || calendar?.userId !== user.id || !calendar.isAutoDefault || calendar.companyId !== value.companyId || mail?.userId !== user.id || !mail.isAutoCreated || !mail.active || mail.companyId !== value.companyId || value.helpFingerprintBefore?.count < 1 || !value.helpFingerprintBefore?.fingerprint) throw fail("IDENTITY_TOPOLOGY_INVALID");
  return { ownership: { ...value, records: [...value.records] }, owned: new Map(value.records.map((row) => [row.id, row])), role, user, calendar, mail };
}

function addCreated(context, rows) {
  if (!Array.isArray(rows) || rows.length !== 2) throw fail("DYNAMIC_OWNERSHIP_INVALID");
  const kinds = new Set(rows.map((row) => row.kind));
  if (!kinds.has("workspace_preference") || !kinds.has("notification_preference") || rows.some((row) => row.ownerRunId !== context.ownership.runId || row.userId !== context.user.id || row.createdInBrowser !== true || context.owned.has(row.id))) throw fail("DYNAMIC_OWNERSHIP_INVALID");
  for (const row of rows) { context.owned.set(row.id, row); context.ownership.records.push(row); }
}

function assertNetwork(rows, mutationOwnership, context) {
  if (!Array.isArray(rows) || !rows.length || rows.some((row) => !same(Object.keys(row).sort(), ["method", "path", "status"]))) throw fail("NETWORK_FIELDS_INVALID");
  for (const row of rows) if (!/^(GET|POST|PUT)$/.test(row.method) || !Number.isInteger(row.status) || row.status < 200 || row.status >= 300 || typeof row.path !== "string" || !row.path.startsWith("/api/v1/") || row.path.includes("://") || row.path.includes("?")) throw fail("NETWORK_NOT_SAME_ORIGIN_RELATIVE");
  if (!sameCounts(counts(rows, (row) => `${row.method} ${row.path}`), ROUTE_COUNTS)) throw fail("NETWORK_ROUTE_CARDINALITY_INVALID");
  const mutations = rows.filter((row) => row.method !== "GET" && row.path !== "/api/v1/auth/login");
  if (!Array.isArray(mutationOwnership) || mutationOwnership.length !== 4 || !sameCounts(counts(mutationOwnership, (row) => `${row.method} ${row.path}`), counts(mutations, (row) => `${row.method} ${row.path}`))) throw fail("MUTATION_EVIDENCE_INCOMPLETE");
  for (const item of mutationOwnership) {
    const owned = context.owned.get(item.id);
    if (!owned || owned.kind !== item.kind) throw fail("MUTATION_OWNERSHIP_MISMATCH");
    if (item.path === "/api/v1/workspace/preferences" && item.kind !== "workspace_preference") throw fail("MUTATION_OWNERSHIP_MISMATCH");
    if (item.path === "/api/v1/notifications/preferences" && item.kind !== "notification_preference") throw fail("MUTATION_OWNERSHIP_MISMATCH");
    if (item.path === "/api/v1/auth/change-password" && item.kind !== "test_user") throw fail("MUTATION_OWNERSHIP_MISMATCH");
  }
}

function validateVisual(value) {
  const common = value?.viewport === "1920x1080" && value.bodyPx === 12 && value.screenTitlePx === 16 && value.helperPx === 10 && value.infoTooltip === true;
  const pass = value?.status === "PASS" && value.sectionTitlePx === 14 && same(value.mismatches, []);
  const knownGap = value?.status === "GAP" && value.sectionTitlePx === 16 && same(value.mismatches, ["sectionTitlePx:16!=14"]);
  if (!common || (!pass && !knownGap)) throw fail("VISUAL_CONTRACT_INVALID");
  return value;
}

function validateBrowser(value, context) {
  scan(value);
  if (value?.status !== "PASS") throw fail("PERSONAL_HELP_COMPOSITE_INCOMPLETE");
  const login = String(value.session?.activeLoginId ?? "").toLowerCase();
  if (PROTECTED.has(login)) throw fail("PROTECTED_ACCOUNT_SESSION_REJECTED");
  if (value.session?.activeUserId !== context.user.id || login !== context.user.loginId.toLowerCase()) throw fail("DISPOSABLE_SESSION_REQUIRED");
  if (!Array.isArray(value.actions) || !ACTIONS.every((action) => value.actions.includes(action))) throw fail("ACTION_EVIDENCE_INCOMPLETE");
  addCreated(context, value.createdRecords);
  if (!value.profile?.matchesPreparedIdentity || !value.profile.readOnly || value.profile.fieldCount !== 5) throw fail("PROFILE_CONTRACT_INVALID");
  if (!same(value.general, { locale: "ko-KR", timezone: "Asia/Tokyo", startPage: "files", version: 1, rereadMatches: true })) throw fail("GENERAL_PREFERENCES_INVALID");
  if (!same(value.notifications, { enabled: true, quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00", mail: { enabled: true, importantOnly: true }, rereadMatches: true })) throw fail("NOTIFICATION_PREFERENCES_INVALID");
  if (!same(value.security, { clientMismatchRequestCount: 0, changeRequestCount: 1, reloginWithNewCredential: true, sensitiveEvidenceFields: 0 })) throw fail("PASSWORD_FLOW_INVALID");
  if (!same(value.modules, { visible: ["mail", "approval", "calendar"], foreignNavigationCount: 0 })) throw fail("MODULE_LINKS_INVALID");
  if (!same(value.help, { allCount: 6, errorSearchCount: 4, errorCategoryCount: 4, emptyCount: 0, selectedDocumentVisible: true, mutationCount: 0, searchEvidencePersisted: false })) throw fail("HELP_CONTRACT_INVALID");
  validateVisual(value.visual);
  if (!Array.isArray(value.screenshots) || value.screenshots.length !== SHOTS.length || new Set(value.screenshots).size !== SHOTS.length || !SHOTS.every((shot) => value.screenshots.includes(shot))) throw fail("SCREENSHOT_EVIDENCE_INCOMPLETE");
  assertNetwork(value.network, value.mutationOwnership, context);
  return value;
}

function validateDb(value, context) {
  scan(value);
  const dynamic = [...context.owned.values()].filter((row) => ["workspace_preference", "notification_preference"].includes(row.kind));
  if (!Array.isArray(value?.rows) || value.rows.length !== 2 || value.existingRowChanges !== 0 || dynamic.some((row) => !value.rows.some((item) => item.id === row.id && item.kind === row.kind && item.userId === context.user.id && item.ownerRunId === context.ownership.runId))) throw fail("DB_EVIDENCE_NOT_RUN_OWNED");
  if (!same(value.preference, { userId: context.user.id, companyId: context.ownership.companyId, locale: "ko-KR", timezone: "Asia/Tokyo", startPage: "files", version: 1 })) throw fail("DB_PREFERENCES_INVALID");
  if (!same(value.notificationPreference, { userId: context.user.id, enabled: true, quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00", mail: { enabled: true, importantOnly: true } })) throw fail("DB_NOTIFICATION_INVALID");
  if (value.helpFingerprint?.before !== context.ownership.helpFingerprintBefore.fingerprint || value.helpFingerprint.after !== value.helpFingerprint.before || value.helpFingerprint.beforeCount !== context.ownership.helpFingerprintBefore.count || value.helpFingerprint.afterCount !== value.helpFingerprint.beforeCount) throw fail("HELP_FINGERPRINT_CHANGED");
  if (!Array.isArray(value.audits) || !sameCounts(counts(value.audits, (row) => row.event), AUDIT_COUNTS) || value.audits.some((row) => row.actorId !== context.user.id || row.targetId !== context.user.id || row.ownerRunId !== context.ownership.runId || !row.reasonSafe)) throw fail("AUDIT_EVIDENCE_INCOMPLETE");
  if (!Array.isArray(value.notificationAudits) || value.notificationAudits.length !== 2 || value.notificationAudits.some((row) => row.event !== "notification.preferences.updated" || row.actorId !== context.user.id || row.targetId !== context.user.id || row.ownerRunId !== context.ownership.runId || !row.reasonSafe)) throw fail("AUDIT_EVIDENCE_INCOMPLETE");
  return value;
}

function validateCleanup(value, context) {
  scan(value);
  const identities = [context.role, context.user];
  const mailAccounts = value?.disposableMailAccounts;
  if (value?.runId !== context.ownership.runId || value.approved !== true || value.residualOwnedRows !== 0 || value.residualOwnedAudit !== 0 || !value.sessionsClosed || value.disposableIdentities?.length !== identities.length || value.disposableIdentities.some((row) => row.active !== false || row.ownerRunId !== context.ownership.runId || !identities.some((item) => item.id === row.id && item.kind === row.kind)) || !Array.isArray(mailAccounts) || mailAccounts.length !== 1 || mailAccounts[0].id !== context.mail.id || mailAccounts[0].userId !== context.user.id || mailAccounts[0].ownerRunId !== context.ownership.runId || mailAccounts[0].active !== false || value.protectedAccounts?.length !== 3 || value.protectedAccounts.some((item) => !stable(item)) || !stable(value.referenceDepartment) || value.existingPreferencesFingerprint?.before !== value.existingPreferencesFingerprint?.after || value.existingNotificationsFingerprint?.before !== value.existingNotificationsFingerprint?.after || value.helpFingerprint?.before !== value.helpFingerprint?.after) throw fail("CLEANUP_INCOMPLETE");
  return value;
}

export async function runPersonalHelp({ manifest, runId, browserDriver, dbDriver, cleanupApproved = false }) {
  assertDrivers(browserDriver, dbDriver);
  const area = manifest.areas.find((item) => item.id === "personal-help");
  if (!area || area.status !== "READY" || area.adapter !== "personal-help") throw fail("AREA_NOT_READY");
  const context = assertBase(await dbDriver.prepareOwnedData({ runId }), runId);
  let browser, db, primaryError, closeError, cleanup, cleanupError;
  try { browser = validateBrowser(await browserDriver.runPersonalHelpFlow({ runId, ownership: context.ownership }), context); db = validateDb(await dbDriver.collectPersonalHelpEvidence({ runId, ownership: context.ownership }), context); } catch (error) { primaryError = error; }
  try { await browserDriver.close(); } catch (error) { closeError = error; }
  if (!cleanupApproved) { if (closeError) throw fail("BROWSER_CLOSE_FAILED"); if (primaryError) throw primaryError; throw fail("CLEANUP_APPROVAL_REQUIRED"); }
  try { cleanup = await dbDriver.cleanupOwnedData({ runId, ownership: context.ownership, approved: true }); } catch (error) { cleanupError = error; }
  if (cleanupError) throw fail("CLEANUP_FAILED");
  const clean = validateCleanup(cleanup, context);
  if (closeError) throw fail("BROWSER_CLOSE_FAILED");
  if (primaryError) throw primaryError;
  return { status: "PASS", areaId: "personal-help", actions: browser.actions, screenshots: browser.screenshots, network: browser.network, mutationOwnership: browser.mutationOwnership, visual: browser.visual, dbAudit: db, cleanup: clean };
}
