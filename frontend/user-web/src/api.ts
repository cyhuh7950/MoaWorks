const defaultApiBase = "/api/v1";

function normalizeBrowserApiBase(value: string | null | undefined) {
  if (!value) {
    return defaultApiBase;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultApiBase;
  }
  return trimmed.startsWith("/") ? trimmed.replace(/\/$/, "") : defaultApiBase;
}

export const apiBase = normalizeBrowserApiBase(
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? window.localStorage.getItem("moaworks.apiBase"),
);

const tokenStorageKey = "moaworks.userToken";

export type ApiError = {
  status?: number;
  code: string;
  userMessage: string;
};

export class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, userMessage: string) {
    super(userMessage);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export type AuthUser = {
  userId: string;
  companyId: string;
  userName: string;
  userEmail: string;
  roleId: string;
  roleName: string;
  userType: string;
  status: string;
  permissions: string[];
  mustChangePassword: boolean;
};

export type LoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
};

export type TranslationTextRequest = {
  text: string;
  sourceLocale: string;
  targetLocale: string;
};

export type TranslationRequest = {
  texts: TranslationTextRequest[];
  includeSource?: boolean;
  useCache?: boolean;
};

export type TranslationItem = {
  sourceLocale: string;
  targetLocale: string;
  originalText: string;
  translatedText: string;
  provider: string;
  source: string;
  cacheHit: boolean;
  translated: boolean;
  statusMessage?: string | null;
};

export type TranslationResponse = {
  requestId: string;
  provider: string;
  providerAvailable: boolean;
  fallbackUsed: boolean;
  items: TranslationItem[];
  executedAt: string;
};

export type UiContract = {
  brand: {
    primary: string;
    secondary: string;
    accent: string;
    blocked: string;
  };
  company: {
    name: string;
    domain: string;
    logoDataUrl: string;
  };
  menuOrder: string[];
  homeCardOrder: string[];
  quickComposeVisible: boolean;
  helpText: string;
  messages: {
    error: string;
    warning: string;
    blocked: string;
    empty: string;
    success: string;
    sessionExpired: string;
    permissionDenied: string;
  };
  source?: string;
};

export type ApprovalLine = {
  id: string;
  documentId: string;
  approverUserId: string;
  approverUserName: string;
  sequence: number;
  status: "pending" | "approved" | "rejected";
  comment?: string;
  decidedByUserId?: string;
  decidedAt?: string;
};

export type ApprovalDocument = {
  id: string;
  title: string;
  content: string;
  creatorUserId: string;
  creatorUserName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedByUserId?: string;
  submittedAt?: string;
  currentLineIndex?: number;
  lines: ApprovalLine[];
};

export type ApprovalListResponse = {
  documents: ApprovalDocument[];
};

export type ApprovalApprover = {
  userId: string;
  userName: string;
  userEmail: string;
  departmentName: string;
};

export type ApprovalApproverListResponse = {
  users: ApprovalApprover[];
};

export type AuditLog = {
  id: string;
  event: string;
  actorUserId: string;
  actorUserName: string;
  targetType: string;
  targetId: string;
  statusBefore?: string;
  statusAfter?: string;
  reason?: string;
  createdAt: string;
};

export type AuditLogListResponse = {
  logs: AuditLog[];
};

export type NotificationRecord = {
  schemaVersion: string;
  eventId: string;
  eventType: string;
  category: "approval" | "mail" | "system";
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  resourceType: string;
  resourceId: string;
  requestId: string;
  dedupKey: string;
  title: string;
  message: string;
  source: string;
  companyId: string;
  actorUserId: string | null;
  occurrenceCount: number;
  occurredAt: string;
  createdAt: string;
  ttlMinutes: number;
  payload: Record<string, unknown>;
  notificationId: string;
  recipientUserIds: string[];
  visibility: "admin" | "user" | "both";
  status: "unread" | "read" | "archived";
  readAt: string | null;
  acknowledgedAt: string | null;
  archivedAt: string | null;
  deliveryChannels: string[];
};

export type NotificationListResponse = {
  notifications: NotificationRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type NotificationSummary = {
  unreadCount: number;
  severityCount: {
    INFO: number;
    WARN: number;
    ERROR: number;
    CRITICAL: number;
  };
  latestCriticalAt: string | null;
  latestWarnAt: string | null;
};

export type NotificationPreferenceCategory = {
  enabled: boolean;
  importantOnly: boolean;
};

export type NotificationPreferences = {
  enabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  categories: Record<string, NotificationPreferenceCategory>;
  updatedAt: string | null;
};

export type NotificationBulkActionResponse = {
  updatedCount: number;
  notifications: NotificationRecord[];
};

export type MeResponse = {
  user: AuthUser;
};

export type PasswordChangeResponse = {
  message: string;
  user: AuthUser;
};

export type MailRecipient = {
  recipientEmail: string;
  recipientUserId: string | null;
  recipientKind: string;
  isRead: boolean | null;
  isStarred: boolean | null;
  receivedAt: string | null;
  readAt: string | null;
};

export type MailAttachment = {
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type MailAttachmentView = {
  fileName: string;
  attachmentId: string;
  contentType: string;
  sizeBytes: number;
};

export type MailSummary = {
  mailId: string;
  accountId: string;
  senderEmail: string;
  subject: string;
  previewText: string;
  status: string;
  isRead: boolean;
  isStarred: boolean;
  sentAt: string | null;
  receivedAt: string | null;
  scheduledAt: string | null;
  retentionExpiresAt: string | null;
  attachmentCount: number;
  category: string;
};

export type MailListResponse = {
  mails: MailSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type MailListQuery = {
  q?: string;
  read?: "all" | "read" | "unread";
  starred?: "all" | "starred" | "unstarred";
  attachment?: "all" | "with" | "without";
  category?: "all" | "primary" | "promotions" | "social" | "updates" | "forums";
  sort?: "date_desc" | "date_asc" | "sender_asc" | "subject_asc";
  limit?: number;
  offset?: number;
};

export type MailFolder = {
  folderId: string;
  name: string;
  sortOrder: number;
  messageCount: number;
};

export type MailTag = {
  tagId: string;
  name: string;
  color: "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";
  sortOrder: number;
  messageCount: number;
};

export type MailFolderListResponse = { folders: MailFolder[] };
export type MailTagListResponse = { tags: MailTag[] };
export type MailStorageResponse = {
  usedBytes: number;
  quotaBytes: number;
  usagePercent: number;
};

export type MailDetail = {
  mailId: string;
  accountId: string;
  senderUserId: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  scheduledAt: string | null;
  updatedAt: string;
  retentionExpiresAt: string | null;
  attachmentCount: number;
  canViewReadReceipts: boolean;
  recipients: MailRecipient[];
  attachments: MailAttachmentView[];
  externalDeliveries: MailExternalDeliveryStatus[];
};

export type MailStatusResponse = {
  mailId: string;
  status: string;
  isRead?: boolean | null;
  isStarred?: boolean | null;
};

export type MailComposePayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: MailAttachment[];
  scheduledAt?: string | null;
  composeAction?: "new" | "reply" | "reply_all" | "forward";
  sourceMailId?: string;
  copiedAttachmentIds?: string[];
};

export type MailDeliveryOutcomeSummary = {
  provider: string;
  engineEnabled: boolean;
  internalRecipientCount: number;
  externalRecipientCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  retryPendingCount: number;
};

export type MailSendResponse = {
  mailId: string;
  status: string;
  sentAt: string | null;
  deliverySummary?: MailDeliveryOutcomeSummary | null;
  scheduledAt?: string | null;
};

export type MailExternalDeliveryStatus = {
  queueId: string;
  recipient: string;
  provider: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
};

export type MessengerParticipant = {
  userId: string;
  userName: string;
  userEmail: string;
};

export type MessengerRoomSummary = {
  roomId: string;
  roomType: string;
  roomName: string;
  participantIds: string[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  readState: string;
  createdAt: string;
  updatedAt: string;
  retentionExpiresAt: string | null;
};

export type MessengerRoomListResponse = {
  rooms: MessengerRoomSummary[];
};

export type MessengerRoomDetail = MessengerRoomSummary & {
  participants: MessengerParticipant[];
};

export type MessengerMessage = {
  messageId: string;
  roomId: string;
  senderUserId: string;
  senderUserName: string;
  messageType: string;
  body: string;
  attachmentMeta: Array<Record<string, unknown>>;
  createdAt: string;
  retentionExpiresAt: string | null;
  readBy: string[];
  readState: string;
};

export type MessengerMessageListResponse = {
  messages: MessengerMessage[];
};

export type MessengerMessageSendResponse = {
  messageId: string;
  roomId: string;
  createdAt: string;
};

export type MessengerReadResponse = {
  roomId: string;
  readAt: string;
  lastReadMessageId: string | null;
};

function extractApiError(response: Response, data: unknown): ApiRequestError {
  const detail =
    typeof data === "object" && data && "detail" in data && typeof (data as { detail?: unknown }).detail === "object"
      ? ((data as { detail: Record<string, unknown> }).detail ?? {})
      : (data as Record<string, unknown> | null) ?? {};
  const source = Object.keys(detail).length ? detail : ((data as Record<string, unknown> | null) ?? {});
  const code = typeof source.code === "string" ? source.code : "REQUEST_FAILED";
  const userMessage =
    typeof source.userMessage === "string"
      ? source.userMessage
      : response.status === 401
        ? "로그인 만료 또는 재로그인이 필요합니다."
        : response.status === 403
          ? "권한이 없습니다."
          : response.status === 423
            ? "비활성 사용자 또는 역할로 차단되었습니다."
            : "요청 처리 실패";
  return new ApiRequestError(response.status, code, userMessage);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw extractApiError(response, data);
  }
  return data as T;
}

export function storeUserToken(token: string) {
  window.localStorage.setItem(tokenStorageKey, token);
}

export function clearUserToken() {
  window.localStorage.removeItem(tokenStorageKey);
}

export function getUserToken() {
  return window.localStorage.getItem(tokenStorageKey) ?? "";
}

export async function fetchMe(token: string): Promise<MeResponse> {
  return request<MeResponse>("/auth/me", {
    headers: authHeaders(token),
  });
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function login(payload: { email: string; password: string }) {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function changePassword(
  token: string,
  payload: { currentPassword: string; newPassword: string },
): Promise<PasswordChangeResponse> {
  return request<PasswordChangeResponse>("/auth/change-password", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function fetchApprovals(token: string): Promise<ApprovalListResponse> {
  return request<ApprovalListResponse>("/approvals", {
    headers: authHeaders(token),
  });
}

export async function createApproval(
  token: string,
  payload: { title: string; content: string; approverUserIds: string[] },
) {
  return request<{ documentId: string }>("/approvals", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function updateApproval(
  token: string,
  documentId: string,
  payload: { title: string; content: string; approverUserIds: string[] },
) {
  return request<ApprovalDocument>(`/approvals/${documentId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function fetchApprovalApprovers(token: string): Promise<ApprovalApproverListResponse> {
  return request<ApprovalApproverListResponse>("/approvals/approvers", {
    headers: authHeaders(token),
  });
}

export async function submitApproval(token: string, documentId: string) {
  return request<ApprovalDocument>(`/approvals/${documentId}/submit`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function approveApproval(token: string, documentId: string, reason: string) {
  return request<ApprovalDocument>(`/approvals/${documentId}/approve`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ reason }),
  });
}

export async function rejectApproval(token: string, documentId: string, reason: string) {
  return request<ApprovalDocument>(`/approvals/${documentId}/reject`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ reason }),
  });
}

export async function withdrawApproval(token: string, documentId: string) {
  return request<ApprovalDocument>(`/approvals/${documentId}/withdraw`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function redraftApproval(token: string, documentId: string) {
  return request<ApprovalDocument>(`/approvals/${documentId}/redraft`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function fetchApprovalLogs(token: string, documentId?: string) {
  const target = documentId ? `/approvals/audit-logs?documentId=${encodeURIComponent(documentId)}` : "/approvals/audit-logs";
  return request<AuditLogListResponse>(target, {
    headers: authHeaders(token),
  });
}

export async function fetchNotifications(token: string, options?: { unreadOnly?: boolean; severity?: string[]; category?: string; cursor?: string; fromAt?: string; toAt?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (options?.unreadOnly !== undefined) query.append("unreadOnly", String(options.unreadOnly));
  if (options?.category) query.append("category", options.category);
  if (options?.cursor) query.append("cursor", options.cursor);
  if (options?.fromAt) query.append("fromAt", options.fromAt);
  if (options?.toAt) query.append("toAt", options.toAt);
  if (options?.limit) query.append("limit", String(options.limit));
  if (options?.severity?.length) {
    options.severity.forEach((value) => query.append("severity", value));
  }
  const qs = query.toString();
  return request<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(token),
  });
}

export async function fetchNotificationStream(
  token: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<string> {
  const query = new URLSearchParams();
  if (options?.cursor) query.append("cursor", options.cursor);
  const qs = query.toString();
  const response = await fetch(`${apiBase}/notifications/stream${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(token),
    signal: options?.signal,
  });
  const payload = await response.text();
  if (!response.ok) {
    let data: unknown = {};
    try {
      data = JSON.parse(payload || "{}") as unknown;
    } catch {
      // non-JSON proxy errors use the standard API error message
    }
    throw extractApiError(response, data);
  }
  return payload;
}

export async function ackNotification(token: string, notificationId: string) {
  return request<NotificationRecord>(`/notifications/${notificationId}/ack`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function bulkReadNotifications(token: string, notificationIds: string[]) {
  return request<NotificationBulkActionResponse>("/notifications/bulk/read", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ notificationIds }),
  });
}

export async function readAllNotifications(token: string, options?: { severity?: string[]; category?: string }) {
  return request<NotificationBulkActionResponse>("/notifications/read-all", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ severities: options?.severity ?? [], category: options?.category ?? null }),
  });
}

export async function archiveNotifications(token: string, notificationIds: string[]) {
  return request<NotificationBulkActionResponse>("/notifications/bulk/archive", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ notificationIds }),
  });
}

export async function fetchNotificationPreferences(token: string) {
  return request<NotificationPreferences>("/notifications/preferences", {
    headers: authHeaders(token),
  });
}

export async function saveNotificationPreferences(token: string, preferences: NotificationPreferences) {
  return request<NotificationPreferences>("/notifications/preferences", {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
}

export async function fetchNotificationSummary(token: string): Promise<NotificationSummary> {
  return request<NotificationSummary>("/notifications/summary", {
    headers: authHeaders(token),
  });
}

export async function requestTranslation(payload: TranslationRequest, token: string): Promise<TranslationResponse> {
  return request<TranslationResponse>("/translation/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchTranslationStatus(): Promise<{ available: boolean; enabled: boolean; provider: string }> {
  return request<{ available: boolean; enabled: boolean; provider: string }>("/translation/status");
}

export async function fetchUiContract(): Promise<UiContract> {
  return request<UiContract>("/ui-contract");
}

function mailListPath(mailbox: "inbox" | "sent" | "drafts", options: MailListQuery = {}) {
  const query = new URLSearchParams();
  if (options.q?.trim()) query.set("q", options.q.trim());
  if (options.read) query.set("read", options.read);
  if (options.starred) query.set("starred", options.starred);
  if (options.attachment) query.set("attachment", options.attachment);
  if (options.category) query.set("category", options.category);
  if (options.sort) query.set("sort", options.sort);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  const suffix = query.toString();
  return `/mail/${mailbox}${suffix ? `?${suffix}` : ""}`;
}

async function fetchMailList(token: string, mailbox: "inbox" | "sent" | "drafts", options?: MailListQuery): Promise<MailListResponse> {
  return request<MailListResponse>(mailListPath(mailbox, options), {
    headers: authHeaders(token),
  });
}

export async function fetchInbox(token: string, options?: MailListQuery): Promise<MailListResponse> {
  return fetchMailList(token, "inbox", options);
}

export async function fetchMailStorage(token: string): Promise<MailStorageResponse> {
  return request<MailStorageResponse>("/mail/storage", {
    headers: authHeaders(token),
  });
}

export type MailBulkAction = "read" | "unread" | "star" | "unstar" | "move" | "delete" | "move_folder" | "add_tag" | "remove_tag" | "spam" | "not_spam" | "restore" | "purge";

export type MailBulkResponse = {
  action: MailBulkAction;
  requestedCount: number;
  changedCount: number;
  unchangedCount: number;
  targetCategory?: string | null;
  targetFolderId?: string | null;
  targetTagId?: string | null;
};

export async function setMailCategory(token: string, mailId: string, category: string): Promise<MailStatusResponse> {
  return request<MailStatusResponse>(`/mail/${mailId}/category`, { method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ category }) });
}

export async function bulkMailAction(
  token: string,
  mailIds: string[],
  action: MailBulkAction,
  mailbox = "inbox",
  targetCategory?: string,
  targetFolderId?: string,
  targetTagId?: string,
): Promise<MailBulkResponse> {
  return request<MailBulkResponse>("/mail/bulk", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ mailIds, action, mailbox, ...(targetCategory ? { targetCategory } : {}),
      ...(targetFolderId ? { targetFolderId } : {}), ...(targetTagId ? { targetTagId } : {}) }),
  });
}

export async function fetchMailFolders(token: string): Promise<MailFolderListResponse> {
  return request<MailFolderListResponse>("/mail/folders", { headers: authHeaders(token) });
}
export async function createMailFolder(token: string, name: string): Promise<MailFolder> {
  return request<MailFolder>("/mail/folders", { method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
}
export async function updateMailFolder(token: string, folderId: string, name: string): Promise<MailFolder> {
  return request<MailFolder>("/mail/folders/" + folderId, { method: "PATCH", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
}
export async function deleteMailFolder(token: string, folderId: string): Promise<void> {
  await request<void>("/mail/folders/" + folderId, { method: "DELETE", headers: authHeaders(token) });
}
export async function fetchMailTags(token: string): Promise<MailTagListResponse> {
  return request<MailTagListResponse>("/mail/tags", { headers: authHeaders(token) });
}
export async function createMailTag(token: string, name: string, color: MailTag["color"]): Promise<MailTag> {
  return request<MailTag>("/mail/tags", { method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ name, color }) });
}
export async function updateMailTag(token: string, tagId: string, name: string, color: MailTag["color"]): Promise<MailTag> {
  return request<MailTag>("/mail/tags/" + tagId, { method: "PATCH", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ name, color }) });
}
export async function deleteMailTag(token: string, tagId: string): Promise<void> {
  await request<void>("/mail/tags/" + tagId, { method: "DELETE", headers: authHeaders(token) });
}
function mailContextPath(path: string, options?: MailListQuery): string {
  const query = new URLSearchParams();
  if (options?.q) query.set("q", options.q);
  if (options?.read) query.set("read", options.read);
  if (options?.starred) query.set("starred", options.starred);
  if (options?.attachment) query.set("attachment", options.attachment);
  if (options?.category) query.set("category", options.category);
  if (options?.sort) query.set("sort", options.sort);
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  if (options?.offset !== undefined) query.set("offset", String(options.offset));
  return path + (query.size ? "?" + query.toString() : "");
}
export async function fetchMailFolderMessages(token: string, folderId: string, options?: MailListQuery): Promise<MailListResponse> {
  return request<MailListResponse>(mailContextPath("/mail/folders/" + folderId + "/messages", options), { headers: authHeaders(token) });
}
export async function fetchMailTagMessages(token: string, tagId: string, options?: MailListQuery): Promise<MailListResponse> {
  return request<MailListResponse>(mailContextPath("/mail/tags/" + tagId + "/messages", options), { headers: authHeaders(token) });
}
export async function fetchMailSpam(token: string, options?: MailListQuery): Promise<MailListResponse> {
  return request<MailListResponse>(mailContextPath("/mail/spam", options), { headers: authHeaders(token) });
}
export async function fetchMailTrash(token: string, options?: MailListQuery): Promise<MailListResponse> {
  return request<MailListResponse>(mailContextPath("/mail/trash", options), { headers: authHeaders(token) });
}
export async function fetchSentMail(token: string, options?: MailListQuery): Promise<MailListResponse> {
  return fetchMailList(token, "sent", options);
}

export async function fetchDraftMail(token: string, options?: MailListQuery): Promise<MailListResponse> {
  return fetchMailList(token, "drafts", options);
}

export type MailDeliveryProviderStatus = {
  providerId: string;
  companyId: string;
  providerKey: string;
  enabled: boolean;
  senderDomain: string;
  heloName: string;
  senderAddress: string;
  useTls: boolean;
  timeoutSec: number;
  maxRetryCount: number;
  retryIntervalSec: number;
  createdAt: string;
  updatedAt: string;
};

export type MailDeliveryQueueSummary = {
  queuedCount: number;
  sendingCount: number;
  sentCount: number;
  failedCount: number;
  retryPendingCount: number;
  cancelledCount: number;
};

export type MailDeliveryStatusResponse = {
  provider: MailDeliveryProviderStatus;
  summary: MailDeliveryQueueSummary;
};

export type MailRecentRecipient = {
  email: string;
  name: string | null;
  departmentName: string | null;
  lastUsedAt: string;
};

export async function fetchRecentMailRecipients(token: string, limit = 20): Promise<{ recipients: MailRecentRecipient[] }> {
  return request<{ recipients: MailRecentRecipient[] }>(`/mail/recent-recipients?limit=${limit}`, {
    headers: authHeaders(token),
  });
}

export async function uploadMailAttachment(token: string, file: File): Promise<MailAttachment> {
  const form = new FormData();
  form.append("file", file);
  return request<MailAttachment>("/mail/attachments", {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
}

export async function downloadMailAttachment(
  token: string,
  mailId: string,
  attachmentId: string,
  fileName: string,
): Promise<void> {
  const response = await fetch(`${apiBase}/mail/${mailId}/attachments/${attachmentId}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw extractApiError(response, data);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function fetchMailDetail(token: string, mailId: string, view = "inbox"): Promise<MailDetail> {
  if (view === "inbox") {
    return request<MailDetail>(`/mail/${mailId}`, {
      headers: authHeaders(token),
    });
  }
  const detailPath = `/mail/${mailId}`;
  return request<MailDetail>(detailPath + "?view=" + encodeURIComponent(view), {
    headers: authHeaders(token),
  });
}

export async function fetchMailDeliveryStatus(token: string): Promise<MailDeliveryStatusResponse> {
  return request<MailDeliveryStatusResponse>("/mail/delivery/status", {
    headers: authHeaders(token),
  });
}

export async function markMailRead(token: string, mailId: string): Promise<MailStatusResponse> {
  return request<MailStatusResponse>(`/mail/${mailId}/read`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function toggleMailStar(token: string, mailId: string): Promise<MailStatusResponse> {
  return request<MailStatusResponse>(`/mail/${mailId}/star`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function saveMailDraft(token: string, payload: MailComposePayload): Promise<MailSendResponse> {
  return request<MailSendResponse>("/mail/draft", {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function sendMail(token: string, payload: MailComposePayload): Promise<MailSendResponse> {
  return request<MailSendResponse>("/mail/send", {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchMessengerRooms(token: string): Promise<MessengerRoomListResponse> {
  return request<MessengerRoomListResponse>("/messenger/rooms", {
    headers: authHeaders(token),
  });
}

export async function createMessengerRoom(token: string, payload: { roomName: string; roomType?: string; participantUserIds: string[] }) {
  return request<MessengerRoomDetail>("/messenger/rooms", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ roomName: payload.roomName, roomType: payload.roomType ?? "group", participantUserIds: payload.participantUserIds }),
  });
}

export async function updateMessengerRoomParticipants(token: string, roomId: string, participantUserIds: string[]) {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}/participants`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ participantUserIds }),
  });
}
export async function fetchMessengerRoom(token: string, roomId: string): Promise<MessengerRoomDetail> {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}`, {
    headers: authHeaders(token),
  });
}

export async function fetchMessengerMessages(token: string, roomId: string): Promise<MessengerMessageListResponse> {
  return request<MessengerMessageListResponse>(`/messenger/rooms/${roomId}/messages`, {
    headers: authHeaders(token),
  });
}

export async function sendMessengerMessage(
  token: string,
  roomId: string,
  payload: { body: string; messageType?: string; attachmentMeta?: Array<Record<string, unknown>> },
): Promise<MessengerMessageSendResponse> {
  return request<MessengerMessageSendResponse>(`/messenger/rooms/${roomId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      body: payload.body,
      messageType: payload.messageType ?? "text",
      attachmentMeta: payload.attachmentMeta ?? [],
    }),
  });
}

export async function readMessengerRoom(token: string, roomId: string): Promise<MessengerReadResponse> {
  return request<MessengerReadResponse>(`/messenger/rooms/${roomId}/read`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export type WorkspaceSchedule = { id: string; title: string; starts_at: string; ends_at: string; description: string; status: string; created_at: string; updated_at: string };
export type WorkspaceContact = { id: string; name: string; email: string; phone: string; company_name: string; memo: string; status: string; created_at: string; updated_at: string };
export type WorkspaceFile = { id: string; file_name: string; content_type: string; size_bytes: number; status: string; created_at: string; updated_at: string };
export type WorkspaceDirectory = { departments: Array<{ id: string; name: string; parent_id: string | null; department_code: string | null }>; users: Array<{ id: string; name: string; email: string; department_name: string; role_name: string }> };
export type WorkspaceHelpPolicy = { id: string; title: string; category: string; content: string; updated_at: string };
export type WorkspaceNotice = { id: string; title: string; content: string; author_name: string; published_at: string; is_read: boolean };
export async function fetchWorkspaceDirectory(token: string) { return request<WorkspaceDirectory>("/workspace/directory", { headers: authHeaders(token) }); }
export async function fetchSchedules(token: string) { return request<{ items: WorkspaceSchedule[] }>("/workspace/schedules", { headers: authHeaders(token) }); }
export async function saveSchedule(token: string, payload: { title: string; startsAt: string; endsAt: string; description: string }, id?: string) { return request<WorkspaceSchedule>(`/workspace/schedules${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function deleteSchedule(token: string, id: string) { return request<void>(`/workspace/schedules/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchContacts(token: string) { return request<{ items: WorkspaceContact[] }>("/workspace/contacts", { headers: authHeaders(token) }); }
export async function saveContact(token: string, payload: { name: string; email: string; phone: string; companyName: string; memo: string }, id?: string) { return request<WorkspaceContact>(`/workspace/contacts${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function deleteContact(token: string, id: string) { return request<void>(`/workspace/contacts/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchWorkspaceFiles(token: string) { return request<{ items: WorkspaceFile[] }>("/workspace/files", { headers: authHeaders(token) }); }
export async function uploadWorkspaceFile(token: string, file: File) { const form = new FormData(); form.append("file", file); return request<WorkspaceFile>("/workspace/files", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }); }
export async function renameWorkspaceFile(token: string, id: string, fileName: string) { return request<WorkspaceFile>(`/workspace/files/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ fileName }) }); }
export async function deleteWorkspaceFile(token: string, id: string) { return request<void>(`/workspace/files/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchWorkspacePreferences(token: string) { return request<{ locale: string; timezone: string }>("/workspace/preferences", { headers: authHeaders(token) }); }
export async function saveWorkspacePreferences(token: string, payload: { locale: string; timezone: string }) { return request<{ locale: string; timezone: string }>("/workspace/preferences", { method: "PUT", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function fetchWorkspaceHelpPolicies(token: string) { return request<{ items: WorkspaceHelpPolicy[] }>("/workspace/help-policies", { headers: authHeaders(token) }); }
export async function fetchWorkspaceNotices(token: string) { return request<{ items: WorkspaceNotice[]; unread_count: number }>("/workspace/notices", { headers: authHeaders(token) }); }
export async function fetchWorkspaceNotice(token: string, id: string) { return request<WorkspaceNotice>(`/workspace/notices/${id}`, { headers: authHeaders(token) }); }
export async function readWorkspaceNotice(token: string, id: string) { return request<WorkspaceNotice>(`/workspace/notices/${id}/read`, { method: "POST", headers: authHeaders(token) }); }
