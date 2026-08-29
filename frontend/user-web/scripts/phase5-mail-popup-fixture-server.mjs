import http from "node:http";
import { randomUUID } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.PHASE5_FIXTURE_PORT || 3521);
const qaEmail = process.env.PHASE5_QA_EMAIL;
const qaPassword = process.env.PHASE5_QA_PASSWORD;
if (!qaEmail || !qaPassword) throw new Error("phase5 QA environment is required");
const accessToken = randomUUID();
let senderDisplayMode = "name";
let senderPreferenceVersion = 1;
let senderPreferenceUnavailable = false;

const user = { userId: "phase5-qa", companyId: "phase5-company", userName: "Phase5 QA", userEmail: qaEmail, roleId: "role-user", roleName: "User", userType: "employee", status: "active", permissions: ["mail:send"], mustChangePassword: false };
const emptyList = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
const inboxList = { mails: [{ mailId: "phase5-sender-mode", accountId: "phase5-account", senderEmail: "hong.gildong@example.test", senderDisplayName: "홍길동", subject: "보낸 사람 표시 검증", previewText: "sender preference pointer", status: "sent", isRead: false, isStarred: false, sentAt: "2026-08-29T00:00:00Z", receivedAt: "2026-08-29T00:00:00Z", scheduledAt: null, retentionExpiresAt: null, attachmentCount: 0, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
const mailDetail = { mailId: "phase5-sender-mode", accountId: "phase5-account", senderUserId: null, senderEmail: "hong.gildong@example.test", senderDisplayName: "홍길동", subject: "보낸 사람 표시 검증", bodyText: "sender preference pointer", bodyHtml: "<p>sender preference pointer</p>", status: "sent", sentAt: "2026-08-29T00:00:00Z", createdAt: "2026-08-29T00:00:00Z", scheduledAt: null, updatedAt: "2026-08-29T00:00:00Z", retentionExpiresAt: null, attachmentCount: 0, canViewReadReceipts: false, effectiveReadPolicy: { blockRemoteImages: false, disableRiskyTags: true }, recipients: [], externalDeliveries: [], attachments: [] };
const basicPreferences = () => ({ senderDisplayMode, blockRemoteImages: false, disableRiskyTags: true, showRouteCountry: false, includeSpamTrashInSearch: false, showListPreview: true, recipientInputMode: "autocomplete", confirmBeforeSend: false, saveSentCopy: true, readReceiptEnabled: false, editorMode: "html", composeMode: "popup", messageEncoding: "utf-8", draftReminderEnabled: false, senderDisplayName: "Phase5 QA", replyToEmail: null, vcardEnabled: false, translationTargetLocale: "en", translationComposeMode: "preview", version: senderPreferenceVersion, updatedAt: "2026-08-29T00:00:00Z" });
const json = (response, value, status = 200) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
const notFound = (response, status = 404) => json(response, { detail: "phase5 fixture route not found" }, status);
const methodNotAllowed = (response) => json(response, { detail: "phase5 fixture method not allowed" }, 405);
const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const getOnly = (request, response, value) => request.method === "GET" ? json(response, value) : methodNotAllowed(response);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  if (url.pathname === "/health") return getOnly(request, response, { status: "ok" });
  if (url.pathname === "/__test/sender-mode") {
    if (request.method !== "PUT") return methodNotAllowed(response);
    let body;
    try { body = await readJson(request); } catch { return json(response, { detail: "invalid JSON" }, 400); }
    if (!["name", "id", "name_email", "unavailable"].includes(body.mode)) return json(response, { detail: "sender mode rejected" }, 422);
    senderPreferenceUnavailable = body.mode === "unavailable";
    if (!senderPreferenceUnavailable) senderDisplayMode = body.mode;
    return json(response, { mode: body.mode });
  }
  if (url.pathname === "/api/v1/auth/login") {
    if (request.method !== "POST") return methodNotAllowed(response);
    let body;
    try { body = await readJson(request); } catch { return json(response, { detail: "invalid JSON" }, 400); }
    if (body.email !== qaEmail || body.password !== qaPassword) return json(response, { detail: "phase5 fixture credentials rejected" }, 401);
    return json(response, { accessToken, tokenType: "bearer", expiresIn: 3600, user });
  }
  if (url.pathname === "/api/v1/auth/me") return getOnly(request, response, { user });
  if (url.pathname === "/api/v1/approvals") return getOnly(request, response, { documents: [] });
  if (url.pathname === "/api/v1/approvals/audit-logs") return getOnly(request, response, { logs: [] });
  if (url.pathname === "/api/v1/workspace/preferences") return getOnly(request, response, { locale: "ko", timezone: "Asia/Seoul", startPage: "mail", version: 1 });
  if (url.pathname === "/api/v1/ui-contract") return getOnly(request, response, { company: { domain: "phase5.invalid" } });
  if (url.pathname === "/api/v1/mail/inbox") return getOnly(request, response, inboxList);
  if (url.pathname === "/api/v1/mail/phase5-sender-mode") return getOnly(request, response, mailDetail);
  if (url.pathname === "/api/v1/mail/phase5-sender-mode/read") return request.method === "POST" ? json(response, { mailId: "phase5-sender-mode", status: "read", isRead: true }) : methodNotAllowed(response);
  if (["/api/v1/mail/sent", "/api/v1/mail/drafts", "/api/v1/mail/scheduled"].includes(url.pathname)) return getOnly(request, response, emptyList);
  if (url.pathname === "/api/v1/mail/delivery/status") return getOnly(request, response, { provider: { enabled: true, lastTestStatus: "success" } });
  if (url.pathname === "/api/v1/mail/preferences/basic") {
    if (request.method === "GET") return senderPreferenceUnavailable ? json(response, { detail: "preference unavailable" }, 503) : json(response, basicPreferences());
    if (request.method !== "PUT") return methodNotAllowed(response);
    let body;
    try { body = await readJson(request); } catch { return json(response, { detail: "invalid JSON" }, 400); }
    if (!["name", "id", "name_email"].includes(body.senderDisplayMode)) return json(response, { detail: "sender mode rejected" }, 422);
    senderDisplayMode = body.senderDisplayMode;
    senderPreferenceVersion += 1;
    return json(response, basicPreferences());
  }
  if (url.pathname === "/api/v1/mail/signatures") return getOnly(request, response, { enabled: false, position: "body_bottom", defaultSignatureId: null, version: 1, updatedAt: "2026-08-27T00:00:00Z", signatures: [] });
  if (url.pathname === "/api/v1/mail/folders") return getOnly(request, response, { folders: [] });
  if (url.pathname === "/api/v1/mail/tags") return getOnly(request, response, { tags: [] });
  if (url.pathname === "/api/v1/mail/storage") return getOnly(request, response, {});
  if (url.pathname === "/api/v1/translation/status") return getOnly(request, response, {});
  if (url.pathname === "/api/v1/messenger/rooms") return getOnly(request, response, { rooms: [] });
  if (url.pathname === "/api/v1/workspace/schedules") return getOnly(request, response, { schedules: [] });
  if (url.pathname === "/api/v1/workspace/notices") return getOnly(request, response, { notices: [] });
  if (url.pathname === "/api/v1/workspace/profile") return getOnly(request, response, {});
  if (url.pathname === "/api/v1/notifications/stream") return getOnly(request, response, {});
  if (url.pathname === "/api/v1/notifications/summary") return getOnly(request, response, { unreadCount: 0, severityCount: { INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 } });
  if (url.pathname === "/api/v1/notifications") return getOnly(request, response, { notifications: [] });
  return notFound(response);
});
server.listen(port, host, () => process.stdout.write("PHASE5_FIXTURE_READY\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
