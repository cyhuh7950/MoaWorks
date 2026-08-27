import http from "node:http";
import { randomUUID } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.PHASE5_FIXTURE_PORT || 3521);
const qaEmail = process.env.PHASE5_QA_EMAIL;
const qaPassword = process.env.PHASE5_QA_PASSWORD;
if (!qaEmail || !qaPassword) throw new Error("phase5 QA environment is required");
const accessToken = randomUUID();

const user = { userId: "phase5-qa", companyId: "phase5-company", userName: "Phase5 QA", userEmail: qaEmail, roleId: "role-user", roleName: "User", userType: "employee", status: "active", permissions: ["mail:send"], mustChangePassword: false };
const emptyList = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
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
  if (["/api/v1/mail/inbox", "/api/v1/mail/sent", "/api/v1/mail/drafts", "/api/v1/mail/scheduled"].includes(url.pathname)) return getOnly(request, response, emptyList);
  if (url.pathname === "/api/v1/mail/delivery/status") return getOnly(request, response, { provider: { enabled: true, lastTestStatus: "success" } });
  if (url.pathname === "/api/v1/mail/preferences/basic") return getOnly(request, response, { senderDisplayMode: "name", blockRemoteImages: false, disableRiskyTags: true, showRouteCountry: false, includeSpamTrashInSearch: false, showListPreview: true, recipientInputMode: "autocomplete", confirmBeforeSend: false, saveSentCopy: true, readReceiptEnabled: false, editorMode: "html", composeMode: "popup", messageEncoding: "utf-8", draftReminderEnabled: false, senderDisplayName: "Phase5 QA", replyToEmail: null, vcardEnabled: false, translationTargetLocale: "en", translationComposeMode: "preview", version: 1, updatedAt: "2026-08-27T00:00:00Z" });
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
  if (url.pathname === "/api/v1/notifications/summary") return getOnly(request, response, {});
  if (url.pathname === "/api/v1/notifications") return getOnly(request, response, { notifications: [] });
  return notFound(response);
});
server.listen(port, host, () => process.stdout.write("PHASE5_FIXTURE_READY\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
