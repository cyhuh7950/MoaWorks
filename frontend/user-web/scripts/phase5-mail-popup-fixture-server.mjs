import http from "node:http";
import { randomUUID } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.PHASE5_FIXTURE_PORT || 3521);
const qaEmail = process.env.PHASE5_QA_EMAIL;
const qaPassword = process.env.PHASE5_QA_PASSWORD;
if (!qaEmail || !qaPassword) throw new Error("phase5 QA environment is required");
const accessToken = randomUUID();
const refreshToken = randomUUID();

const user = { userId: "phase5-qa", companyId: "phase5-company", userName: "Phase5 QA", userEmail: qaEmail, roleId: "role-user", roleName: "User", userType: "employee", status: "active", permissions: ["mail:send"], mustChangePassword: false };
const emptyList = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
const json = (response, value, status = 200) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  if (url.pathname === "/health") return json(response, { status: "ok" });
  if (url.pathname === "/api/v1/auth/login" && request.method === "POST") return json(response, { accessToken, refreshToken, user });
  if (url.pathname === "/api/v1/auth/me") return json(response, { user });
  if (url.pathname === "/api/v1/approvals") return json(response, { documents: [] });
  if (url.pathname === "/api/v1/approvals/audit-logs") return json(response, { logs: [] });
  if (url.pathname.includes("/workspace/preferences")) return json(response, { locale: "ko", timezone: "Asia/Seoul", startPage: "mail", version: 1 });
  if (url.pathname === "/api/v1/ui-contract") return json(response, {});
  if (url.pathname.includes("/mail/inbox") || url.pathname.includes("/mail/sent") || url.pathname.includes("/mail/drafts") || url.pathname.includes("/mail/scheduled")) return json(response, emptyList);
  if (url.pathname.includes("/mail/delivery/status")) return json(response, { provider: { enabled: true, lastTestStatus: "success" } });
  if (url.pathname.includes("/mail/preferences/basic")) return json(response, { senderDisplayMode: "name", blockRemoteImages: false, disableRiskyTags: true, showRouteCountry: false, includeSpamTrashInSearch: false, showListPreview: true, recipientInputMode: "autocomplete", confirmBeforeSend: false, saveSentCopy: true, readReceiptEnabled: false, editorMode: "html", composeMode: "popup", messageEncoding: "utf-8", draftReminderEnabled: false, senderDisplayName: "Phase5 QA", replyToEmail: null, vcardEnabled: false, translationTargetLocale: "en", translationComposeMode: "preview", version: 1, updatedAt: "2026-08-27T00:00:00Z" });
  if (url.pathname.includes("/mail/signatures")) return json(response, { enabled: false, position: "body_bottom", defaultSignatureId: null, version: 1, updatedAt: "2026-08-27T00:00:00Z", signatures: [] });
  if (url.pathname.includes("/mail/folders")) return json(response, { folders: [] });
  if (url.pathname.includes("/mail/tags")) return json(response, { tags: [] });
  return json(response, {});
});
server.listen(port, host, () => process.stdout.write("PHASE5_FIXTURE_READY\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
