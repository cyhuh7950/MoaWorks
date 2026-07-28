export const MAIL_SENSITIVE_KEY = /password|hash|token|cookie|authorization|secret|set-cookie|credential(?!configured)/i;
const PROTECTED = new Set(["admin", "cyhuh", "ysla"]);

export const CORE_ACTIONS = ["mail.list", "mail.detail", "mail.draft.save", "mail.draft.reread", "mail.send", "mail.reply", "mail.forward", "mail.recipient.read", "mail.receipt.reread", "mail.star", "mail.tag", "mail.folder.move", "mail.spam", "mail.not_spam", "mail.trash", "mail.restore", "mail.purge"];
const CORE_SCREENSHOTS = ["screenshots/mail-inbox.png", "screenshots/mail-detail.png", "screenshots/mail-receipt.png", "screenshots/mail-state.png"];

export function mailContractError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function assertNoMailSensitiveKeys(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (MAIL_SENSITIVE_KEY.test(key)) throw mailContractError(`SENSITIVE_FIELD_REJECTED:${path}.${key}`);
    if (item && typeof item === "object") assertNoMailSensitiveKeys(item, `${path}.${key}`);
  }
}

export function assertMailNetwork(records) {
  if (!Array.isArray(records) || records.length === 0) throw mailContractError("NETWORK_EVIDENCE_INCOMPLETE");
  for (const record of records) {
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["method", "path", "status"])) throw mailContractError("NETWORK_FIELDS_INVALID");
    if (typeof record.path !== "string") throw mailContractError("NETWORK_NOT_SAME_ORIGIN_RELATIVE");
    if (record.path.includes("?")) throw mailContractError("NETWORK_QUERY_REJECTED");
    if (record.path.includes("://") || !(record.path === "/api/v1/mail" || record.path.startsWith("/api/v1/mail/"))) throw mailContractError("NETWORK_NOT_SAME_ORIGIN_RELATIVE");
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(record.method) || !Number.isInteger(record.status) || record.status < 200 || record.status >= 400) throw mailContractError("NETWORK_EVIDENCE_INVALID");
  }
}

export function assertMutationOwnership(items, records, context, requirements) {
  if (!Array.isArray(items) || items.length !== requirements.length) throw mailContractError("MUTATION_OWNERSHIP_INCOMPLETE");
  const owned = new Map(context.ownership.records.map((record) => [record.kind, record.id]));
  for (const item of items) {
    if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["id", "kind", "method", "path"])) throw mailContractError("MUTATION_OWNERSHIP_FIELDS_INVALID");
    if (owned.get(item.kind) !== item.id) throw mailContractError("MUTATION_OWNERSHIP_MISMATCH");
    if (!records.some((record) => record.method === item.method && record.path === item.path && record.status >= 200 && record.status < 300)) throw mailContractError("MUTATION_OWNERSHIP_NETWORK_MISMATCH");
  }
  const expected = requirements.map(({ kind, method, path }) => `${kind}|${owned.get(kind)}|${method}|${path}`).sort();
  const actual = items.map(({ kind, id, method, path }) => `${kind}|${id}|${method}|${path}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw mailContractError("MUTATION_OWNERSHIP_INCOMPLETE");
}

export function assertScreenshotSet(screenshots, required) {
  if (!Array.isArray(screenshots) || screenshots.length !== required.length || new Set(screenshots).size !== screenshots.length) throw mailContractError("SCREENSHOT_EVIDENCE_INCOMPLETE");
  if (screenshots.some((path) => !/^screenshots\/[A-Za-z0-9._-]+\.png$/.test(path))) throw mailContractError("SCREENSHOT_PATH_REJECTED");
  if (!required.every((path) => screenshots.includes(path))) throw mailContractError("SCREENSHOT_EVIDENCE_INCOMPLETE");
}

function has2xx(records, methods, matcher) {
  return records.some((record) => methods.includes(record.method) && record.status >= 200 && record.status < 300 && matcher(record.path));
}

function assertCoreNetworkFamilies(records) {
  const exact = (method, path) => has2xx(records, [method], (value) => value === path);
  const reserved = new Set(["inbox", "sent", "drafts", "attachments", "draft", "send", "bulk", "folders", "tags", "preferences", "signatures", "mailbox-settings", "spam-settings", "settings"]);
  const dynamicDetail = (path) => {
    const match = path.match(/^\/api\/v1\/mail\/([^/]+)$/);
    return Boolean(match && !reserved.has(match[1]));
  };
  const checks = [
    exact("GET", "/api/v1/mail/inbox"), exact("GET", "/api/v1/mail/sent"), exact("GET", "/api/v1/mail/drafts"),
    exact("POST", "/api/v1/mail/attachments"), exact("POST", "/api/v1/mail/draft"), exact("POST", "/api/v1/mail/send"),
    has2xx(records, ["GET"], dynamicDetail),
    has2xx(records, ["POST"], (path) => /^\/api\/v1\/mail\/[^/]+\/read$/.test(path)),
    has2xx(records, ["POST"], (path) => /^\/api\/v1\/mail\/[^/]+\/star$/.test(path)),
    exact("POST", "/api/v1/mail/bulk"),
    has2xx(records, ["GET", "POST"], (path) => path === "/api/v1/mail/folders"),
    has2xx(records, ["GET", "POST"], (path) => path === "/api/v1/mail/tags"),
  ];
  if (checks.some((passed) => !passed)) throw mailContractError("CORE_NETWORK_FAMILY_INCOMPLETE");
}

function assertCoreMutationProof(records, context) {
  const successful = (method, path) => records.find((record) => record.method === method && record.path === path && record.status >= 200 && record.status < 300);
  const folderGet = successful("GET", "/api/v1/mail/folders");
  const folderPost = successful("POST", "/api/v1/mail/folders");
  const tagGet = successful("GET", "/api/v1/mail/tags");
  const tagPost = successful("POST", "/api/v1/mail/tags");
  if (!folderGet || !folderPost || !tagGet || !tagPost) throw mailContractError("CORE_NETWORK_MUTATION_INCOMPLETE");

  const ownedMailIds = new Set(context.ownership.records.filter((record) => record.kind === "mail_message").map((record) => record.id));
  const reserved = new Set(["inbox", "sent", "drafts", "attachments", "draft", "send", "bulk", "folders", "tags", "preferences", "signatures", "mailbox-settings", "spam-settings", "settings"]);
  const dynamicRecords = records.filter((record) => {
    const match = record.path.match(/^\/api\/v1\/mail\/([^/]+)(?:\/(?:read|star))?$/);
    return Boolean(match && !reserved.has(match[1]));
  });
  for (const record of dynamicRecords) {
    const id = record.path.split("/")[4];
    if (!ownedMailIds.has(id)) throw mailContractError("NETWORK_OWNERSHIP_MISMATCH");
  }
}

function isProtected(loginId) {
  return typeof loginId === "string" && PROTECTED.has(loginId.toLowerCase());
}

export function assertMailSessions(sessions, context) {
  if (!Array.isArray(sessions) || sessions.length === 0) throw mailContractError("MAIL_SESSION_EVIDENCE_INCOMPLETE");
  const allowed = new Set([context.sender.loginId.toLowerCase(), context.recipient.loginId.toLowerCase()]);
  for (const session of sessions) {
    if (isProtected(session.activeLoginId)) throw mailContractError("PROTECTED_ACCOUNT_SESSION_REJECTED");
    if (typeof session.activeLoginId !== "string" || !allowed.has(session.activeLoginId.toLowerCase())) throw mailContractError("MAIL_SESSION_NOT_DISPOSABLE");
  }
}

export function assertInternalTargets(targets, context) {
  if (!Array.isArray(targets) || targets.length === 0) throw mailContractError("MAIL_TARGET_EVIDENCE_INCOMPLETE");
  const allowedIds = new Set([context.sender.id, context.recipient.id]);
  const allowedAddresses = new Set([context.sender.email.toLowerCase(), context.recipient.email.toLowerCase()]);
  for (const target of targets) {
    const localPart = typeof target.address === "string" ? target.address.toLowerCase().split("@")[0] : "";
    if (PROTECTED.has(localPart)) throw mailContractError("PROTECTED_ACCOUNT_TARGET_REJECTED");
    if (typeof target.address !== "string" || !allowedIds.has(target.userId) || !allowedAddresses.has(target.address.toLowerCase())) throw mailContractError("MAIL_TARGET_NOT_INTERNAL");
  }
}

export function validateMailCore(result, context, runId) {
  assertNoMailSensitiveKeys(result, "mailCore");
  const actions = new Set(result?.actions ?? []);
  if (!CORE_ACTIONS.every((action) => actions.has(action))) throw mailContractError("CORE_ACTION_EVIDENCE_INCOMPLETE");
  assertMailSessions(result.sessions, context);
  assertInternalTargets(result.targets, context);
  const sessionIds = new Set(result.sessions.map((session) => session.activeLoginId.toLowerCase()));
  if (![context.sender.loginId, context.recipient.loginId].every((loginId) => sessionIds.has(loginId.toLowerCase()))) throw mailContractError("MAIL_SESSION_EVIDENCE_INCOMPLETE");
  const targetIds = new Set(result.targets.map((target) => target.userId));
  if (![context.sender.id, context.recipient.id].every((userId) => targetIds.has(userId))) throw mailContractError("MAIL_TARGET_EVIDENCE_INCOMPLETE");
  assertMailNetwork(result.network);
  assertCoreNetworkFamilies(result.network);
  assertCoreMutationProof(result.network, context);
  assertMutationOwnership(result.mutationOwnership, result.network, context, [
    { kind: "mail_folder", method: "POST", path: "/api/v1/mail/folders" },
    { kind: "mail_tag", method: "POST", path: "/api/v1/mail/tags" },
  ]);
  assertScreenshotSet(result.screenshots, CORE_SCREENSHOTS);
  const attachment = result.attachment;
  const ownedAttachment = context.ownership.records.find((record) => record.kind === "mail_attachment");
  if (!attachment || attachment.id !== ownedAttachment?.id || attachment.ownerRunId !== runId || typeof attachment.fileName !== "string" || !attachment.fileName.toLowerCase().includes(runId.toLowerCase()) || !attachment.fileName.toLowerCase().endsWith(".txt") || attachment.mimeType !== "text/plain" || !Number.isInteger(attachment.sizeBytes) || attachment.sizeBytes < 0 || attachment.sizeBytes > 1024 || typeof attachment.storageKey !== "string" || !attachment.storageKey.toLowerCase().includes(runId.toLowerCase())) throw mailContractError("ATTACHMENT_CONTRACT_INVALID");
  const receipt = result.receipt;
  const ownedRecipient = context.ownership.records.find((record) => record.kind === "mail_recipient");
  const ownedMailIds = new Set(context.ownership.records.filter((record) => record.kind === "mail_message").map((record) => record.id));
  if (!receipt || receipt.actorId !== context.recipient.id || receipt.targetId !== ownedRecipient?.id || receipt.recipientRowId !== ownedRecipient?.id || !ownedMailIds.has(receipt.mailId) || receipt.isRead !== true || receipt.readAtPresent !== true || receipt.senderDetailConfirmed !== true) throw mailContractError("RECEIPT_CONTRACT_INVALID");
  if (receipt.recipientMaskingConfirmed !== true) throw mailContractError("RECIPIENT_MASKING_REQUIRED");
  if (result.rereadConfirmed !== true) throw mailContractError("CORE_REREAD_REQUIRED");
  return { status: result.status === "PASS" ? "PASS" : "FAIL", actions: result.actions, network: result.network, mutationOwnership: result.mutationOwnership, screenshots: result.screenshots, receipt, attachment };
}
