import {
  readPersonalAiChatResponse,
  readPersonalAiConfig,
  readPersonalAiConnectionTest,
  readPersonalAiModelList,
  readPersonalAiProviders,
} from "./personalAi";

const defaultApiBase = "/api/v1";
const browserApiPathSegmentPattern = /^[A-Za-z0-9._~-]+$/;

function normalizeBrowserApiBase(value: string | null | undefined) {
  if (!value) {
    return defaultApiBase;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return defaultApiBase;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultApiBase;
  }
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    /[\\%?#\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return defaultApiBase;
  }
  const normalized = trimmed.replace(/\/+$/, "");
  const segments = normalized.slice(1).split("/");
  if (
    !normalized ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || !browserApiPathSegmentPattern.test(segment))
  ) {
    return defaultApiBase;
  }
  return `/${segments.join("/")}`;
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
  currentCount: number | null;

  constructor(status: number, code: string, userMessage: string, currentCount: number | null = null) {
    super(userMessage);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.currentCount = currentCount;
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

export type PersonalAiConnectionStatus = "unconfigured" | "untested" | "ready" | "error";
export type PersonalAiConfigSource = "personal" | "admin_default" | "unconfigured";

export type PersonalAiProviderOption = {
  provider: string;
  label: string;
  apiKeyRequired: boolean;
};

export type PersonalAiConfig = {
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  connectionStatus: PersonalAiConnectionStatus;
  lastTestCode: string | null;
  lastTestedAt: string | null;
  configSource: PersonalAiConfigSource;
};

export type PersonalAiModelList = {
  success: boolean;
  provider: string;
  models: string[];
  code: string;
  message: string;
  loadedAt: string;
};

export type PersonalAiConnectionTest = {
  success: boolean;
  provider: string;
  model: string;
  code: string;
  message: string;
  connectionStatus: PersonalAiConnectionStatus;
  testedAt: string;
};

export type PersonalAiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type PersonalAiChatResponse = {
  provider: string;
  model: string;
  message: PersonalAiChatMessage;
  generatedAt: string;
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
  decidedByUserName?: string;
  decidedAt?: string;
  hasSignature: boolean;
  signatureUrl?: string;
  delegationId?: string;
};

export type ApprovalDocument = {
  id: string;
  title: string;
  content: string;
  creatorUserId: string;
  creatorUserName: string;
  creatorDepartmentId?: string;
  creatorDepartmentName?: string;
  urgent: boolean;
  referenceUserIds: string[];
  viewerUserIds: string[];
  currentUserAudienceType?: "reference" | "viewer";
  currentUserReadAt?: string;
  sharedWithDepartment: boolean;
  currentUserDepartmentMember: boolean;
  deletedForCurrentUser: boolean;
  permanentlyDeletedForCurrentUser: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedByUserId?: string;
  submittedAt?: string;
  currentLineIndex?: number;
  canCurrentUserAct: boolean;
  lines: ApprovalLine[];
};

export type ApprovalAttachment = {
  attachmentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  previewUrl?: string;
};

export type ApprovalBasicPreferences = {
  writingMethod: "general";
  attachmentImageDisplay: "thumbnail" | "original" | "filename";
  version: number;
  hasSignature: boolean;
  signatureFileName?: string;
  signatureContentType?: "image/png" | "image/jpeg" | "image/webp";
  signatureSizeBytes?: number;
  signatureUrl?: string;
};

export type ApprovalDelegation = {
  delegationId: string;
  ownerUserId: string;
  delegateUserId: string;
  delegateUserName: string;
  delegateUserEmail: string;
  departmentName: string;
  startDate: string;
  endDate: string;
  reason: string;
  enabled: boolean;
  status: "disabled" | "scheduled" | "active" | "expired";
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalDelegationPayload = {
  delegateUserId: string;
  startDate: string;
  endDate: string;
  reason: string;
  enabled: boolean;
};

export type ApprovalDelegationListResponse = {
  items: ApprovalDelegation[];
  total: number;
  page: number;
  pageSize: number;
};

export type ApprovalAttachmentUpload = {
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type ApprovalDraftPayload = {
  title: string;
  content: string;
  approverUserIds: string[];
  referenceUserIds: string[];
  viewerUserIds: string[];
  urgent: boolean;
  shareWithDepartment: boolean;
  attachments: ApprovalAttachmentUpload[];
};

export type ApprovalDraftUpdatePayload = ApprovalDraftPayload & {
  retainedAttachmentIds: string[];
};

export type ApprovalDocumentDetail = ApprovalDocument & {
  attachments: ApprovalAttachment[];
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

export type MailUploadDisposition = "attachment" | "inline";

export type MailAttachment = {
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  disposition?: MailUploadDisposition;
  contentId?: string | null;
  previewPath?: string | null;
};

export type MailAttachmentView = {
  fileName: string;
  attachmentId: string;
  contentType: string;
  sizeBytes: number;
  disposition?: MailUploadDisposition;
  contentId?: string | null;
  previewPath?: string | null;
};

export type MailSummary = {
  mailId: string;
  accountId: string | null;
  senderEmail: string;
  senderDisplayName: string;
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
  sourceMailbox?: "inbox" | "sent" | "draft" | null;
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

export type MailboxSettingsRow = {
  mailboxKey: string;
  name: string;
  mailboxType: string;
  retentionDays: 30 | 90 | 180 | 365 | null;
  retentionEditable: boolean;
  unreadCount: number | null;
  totalCount: number;
  usedBytes: number;
  version: number;
};

export type MailBackupJob = {
  jobId: string;
  mailboxKey: string;
  mailboxLabel: string;
  status: "queued" | "running" | "completed" | "failed" | "expired";
  totalCount: number;
  processedCount: number;
  artifactSizeBytes: number;
  errorCode: string | null;
  expiresAt: string | null;
};

export type MailMailboxSettingsResponse = {
  mailboxes: MailboxSettingsRow[];
  tags: MailTag[];
  storage: MailStorageResponse;
  backupJobs: MailBackupJob[];
};

export type MailMailboxEmptyResponse = {
  mailboxKey: string;
  changedCount: number;
  currentCount: number;
};

export type MailSpamRule = {
  ruleId: string;
  ruleType: "allow" | "deny";
  matchType: "email" | "domain";
  matchValue: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MailSpamSettingsResponse = {
  filterEnabled: boolean;
  blockedAction: "move_to_spam";
  version: number;
  updatedAt: string;
  rules: MailSpamRule[];
};

export type MailSpamRulePayload = Pick<MailSpamRule, "ruleType" | "matchType" | "matchValue" | "enabled">;

export type MailAutoClassificationCondition = {
  field: "sender_email" | "sender_domain" | "recipient_email" | "subject" | "body" | "attachment";
  operator: "equals" | "contains" | "subdomain" | "starts_with" | "ends_with" | "exists" | "missing";
  value: string | null;
};
export type MailAutoClassificationRulePayload = {
  name: string; enabled: boolean; conditions: MailAutoClassificationCondition[];
  targetFolderId: string | null; tagIds: string[];
};
export type MailAutoClassificationRule = MailAutoClassificationRulePayload & {
  ruleId: string; priority: number; version: number;
  lastEvent: { result: "applied" | "matched_noop" | "failed"; folderApplied: boolean; tagCount: number; reasonCode: string; createdAt: string } | null;
  createdAt: string; updatedAt: string;
};
export type MailAutoClassificationSettings = {
  enabled: boolean; version: number; updatedAt: string;
  rules: MailAutoClassificationRule[]; folders: MailFolder[]; tags: MailTag[];
};

export type MailAutoForwardLastResult = { status: "internal_delivered" | "queued" | "blocked" | "retry_pending" | "sent" | "failed"; reasonCode: string; createdAt: string };
export type MailAutoForwardTarget = { targetId: string; email: string; targetKind: "internal" | "external"; lastResult: MailAutoForwardLastResult | null };
export type MailAutoForwardExceptionPayload = { matcherType: "sender_email" | "sender_domain"; matcherValue: string; action: "skip" | "override"; targetEmails: string[]; enabled: boolean };
export type MailAutoForwardException = MailAutoForwardExceptionPayload & { exceptionId: string; version: number; lastResult: MailAutoForwardLastResult | null; createdAt: string; updatedAt: string };
export type MailAutoForwardSettings = { enabled: boolean; keepOriginal: boolean; version: number; updatedAt: string; providerLocked: boolean; targets: MailAutoForwardTarget[]; exceptions: MailAutoForwardException[] };
export type MailOutOfOfficeLastResult = { status: "internal_delivered" | "queued" | "blocked" | "retry_pending" | "sent" | "failed"; reasonCode: string; createdAt: string };
export type MailOutOfOfficeSettings = {
  enabled: boolean;
  startDate: string | null;
  endDate: string | null;
  subject: string;
  message: string;
  targetScope: "all" | "internal" | "external";
  version: number;
  state: "disabled" | "scheduled" | "active" | "expired";
  lastResult: MailOutOfOfficeLastResult | null;
  responseCount: number;
  providerLocked: boolean;
  updatedAt: string;
};

export type MailExternalAccount = {
  id: string; display_name: string; host: string; port: 110 | 995; tls_mode: "ssl" | "starttls";
  username: string; target_folder_id: string | null; delete_from_server: boolean; enabled: boolean;
  connection_status: "untested" | "success" | "failed"; passwordConfigured: boolean;
  last_test_at: string | null; last_test_code: string | null; last_collect_at: string | null;
  version: number; created_at: string; updated_at: string;
  lastJob: null | { status: "queued" | "running" | "completed" | "partial" | "failed"; importedCount: number; duplicateCount: number; deletedCount: number; failedCount: number; errorCode: string | null; completedAt: string | null };
};
export type MailExternalAccountList = { accounts: MailExternalAccount[]; accountCount: number; activeJobCount: number };
export type MailExternalAccountPayload = {
  displayName: string; host: string; port: 110 | 995; tlsMode: "ssl" | "starttls"; username: string;
  password?: string | null; targetFolderId: string | null; deleteFromServer: boolean; enabled: boolean; expectedVersion?: number;
};

export type MailDetail = {
  mailId: string;
  accountId: string | null;
  senderUserId: string | null;
  senderEmail: string;
  senderDisplayName: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  sourceMailId?: string | null;
  sourceAction?: "reply" | "reply_all" | "forward" | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  scheduledAt: string | null;
  updatedAt: string;
  retentionExpiresAt: string | null;
  attachmentCount: number;
  canViewReadReceipts: boolean;
  effectiveReadPolicy: { blockRemoteImages: boolean; disableRiskyTags: boolean };
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
  retainedAttachmentIds?: string[];
  confirmed?: boolean;
};

export type MailDraftUpdatePayload = MailComposePayload & {
  retainedAttachmentIds: string[];
};

export type MailSendResponse = {
  mailId: string;
  status: string;
  sentAt: string | null;
  internalCount: number;
  externalCount: number;
  queuedCount: number;
  blockedCount: number;
  scheduledAt?: string | null;
};

export type MailExternalDeliveryStatus = {
  recipientEmail: string; recipientKind: string; status: string; attemptCount: number;
  nextAttemptAt: string | null; sentAt: string | null; lastError: string | null;
};

export type MessengerParticipant = {
  userId: string;
  userName: string;
  userEmail: string;
  departmentName: string;
  joinedAt: string | null;
  lastReadAt: string | null;
};

export type MessengerAttachment = {
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type MessengerAttachmentView = Omit<MessengerAttachment, "uploadId"> & { attachmentId: string };

export type MessengerRoomSummary = {
  roomId: string;
  roomType: string;
  roomName: string;
  translationLocale: "ko" | "en" | "ja" | "zh-cn" | "es" | "fr" | "de";
  participantIds: string[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  readState: string;
  isFavorite: boolean;
  participantCount: number;
  createdByUserId: string;
  canManageParticipants: boolean;
  canLeave: boolean;
  canDelete: boolean;
  status: string;
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
  senderLocale: string;
  messageType: string;
  body: string;
  attachmentMeta: Array<Record<string, unknown>>;
  attachments: MessengerAttachmentView[];
  createdAt: string;
  retentionExpiresAt: string | null;
  readBy: string[];
  readState: string;
  recipientCount: number;
  readCount: number;
  unreadCount: number;
};

export type MessengerMessageListResponse = {
  messages: MessengerMessage[];
  nextCursor: string | null;
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
  const currentCount =
    typeof source.currentCount === "number" && Number.isFinite(source.currentCount)
      ? source.currentCount
      : null;
  return new ApiRequestError(response.status, code, userMessage, currentCount);
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

export async function fetchApprovalDetail(token: string, documentId: string): Promise<ApprovalDocumentDetail> {
  return request<ApprovalDocumentDetail>(`/approvals/${documentId}`, {
    headers: authHeaders(token),
  });
}

export type ApprovalTrashActionResponse = {
  documentId: string;
  state: "deleted" | "restored" | "permanently_deleted";
};

export async function markApprovalRead(token: string, documentId: string): Promise<ApprovalDocumentDetail> {
  return request<ApprovalDocumentDetail>(`/approvals/${documentId}/read`, { method: "POST", headers: authHeaders(token) });
}

export async function deleteApprovalDocument(token: string, documentId: string): Promise<ApprovalTrashActionResponse> {
  return request<ApprovalTrashActionResponse>(`/approvals/${documentId}`, { method: "DELETE", headers: authHeaders(token) });
}

export async function restoreApprovalDocument(token: string, documentId: string): Promise<ApprovalTrashActionResponse> {
  return request<ApprovalTrashActionResponse>(`/approvals/${documentId}/restore`, { method: "POST", headers: authHeaders(token) });
}

export async function permanentlyDeleteApprovalDocument(token: string, documentId: string): Promise<ApprovalTrashActionResponse> {
  return request<ApprovalTrashActionResponse>(`/approvals/${documentId}/permanent`, { method: "DELETE", headers: authHeaders(token) });
}

export async function downloadApprovalAttachment(token: string, documentId: string, attachmentId: string, fileName: string) {
  const response = await fetch(`${apiBase}/approvals/${documentId}/attachments/${attachmentId}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw extractApiError(response, await response.json().catch(() => ({})));
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export async function createApproval(
  token: string,
  payload: ApprovalDraftPayload,
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
  payload: ApprovalDraftUpdatePayload,
) {
  return request<ApprovalDocumentDetail>(`/approvals/${documentId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function uploadApprovalAttachment(token: string, file: File): Promise<ApprovalAttachmentUpload> {
  const form = new FormData();
  form.append("file", file);
  return request<ApprovalAttachmentUpload>("/approvals/attachments", {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
}

export async function fetchApprovalApprovers(token: string): Promise<ApprovalApproverListResponse> {
  return request<ApprovalApproverListResponse>("/approvals/approvers", {
    headers: authHeaders(token),
  });
}

export async function fetchApprovalBasicPreferences(token: string): Promise<ApprovalBasicPreferences> {
  return request<ApprovalBasicPreferences>("/approvals/settings/basic", {
    headers: authHeaders(token),
  });
}

export async function updateApprovalBasicPreferences(
  token: string,
  value: Pick<ApprovalBasicPreferences, "writingMethod" | "attachmentImageDisplay" | "version">,
  removeSignature: boolean,
  signature?: File,
): Promise<ApprovalBasicPreferences> {
  const form = new FormData();
  form.append("writingMethod", value.writingMethod);
  form.append("attachmentImageDisplay", value.attachmentImageDisplay);
  form.append("expectedVersion", String(value.version));
  form.append("removeSignature", String(removeSignature));
  if (signature) form.append("signature", signature);
  return request<ApprovalBasicPreferences>("/approvals/settings/basic", {
    method: "PUT",
    headers: authHeaders(token),
    body: form,
  });
}

export async function fetchApprovalDelegations(
  token: string,
  page = 1,
  pageSize = 20,
): Promise<ApprovalDelegationListResponse> {
  return request<ApprovalDelegationListResponse>(`/approvals/settings/delegations?page=${page}&pageSize=${pageSize}`, {
    headers: authHeaders(token),
  });
}

export async function createApprovalDelegation(token: string, payload: ApprovalDelegationPayload) {
  return request<ApprovalDelegation>("/approvals/settings/delegations", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function updateApprovalDelegation(
  token: string,
  delegationId: string,
  payload: ApprovalDelegationPayload & { expectedVersion: number },
) {
  return request<ApprovalDelegation>(`/approvals/settings/delegations/${delegationId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function deleteApprovalDelegation(token: string, delegationId: string, expectedVersion: number) {
  return request<ApprovalDelegation>(`/approvals/settings/delegations/${delegationId}?expectedVersion=${expectedVersion}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function fetchApprovalInlineImage(token: string, relativeUrl: string): Promise<string> {
  if (!relativeUrl.startsWith("/api/v1/approvals/")) throw new Error("결재 이미지 경로가 올바르지 않습니다.");
  const response = await fetch(relativeUrl, { headers: authHeaders(token) });
  if (!response.ok) throw extractApiError(response, await response.json().catch(() => ({})));
  return URL.createObjectURL(await response.blob());
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

export async function fetchTranslationStatus(token: string): Promise<{ available: boolean; enabled: boolean; provider: string }> {
  return request<{ available: boolean; enabled: boolean; provider: string }>("/translation/status", {
    headers: authHeaders(token),
  });
}

export async function fetchPersonalAiProviders(token: string): Promise<{ providers: PersonalAiProviderOption[] }> {
  return readPersonalAiProviders(await request<unknown>("/workspace/personal-ai/providers", {
    headers: authHeaders(token),
  }));
}

export async function fetchPersonalAiConfig(token: string): Promise<PersonalAiConfig> {
  return readPersonalAiConfig(await request<unknown>("/workspace/personal-ai/config", {
    headers: authHeaders(token),
  }));
}

export async function updatePersonalAiConfig(
  token: string,
  payload: { provider: string; model: string; apiKey?: string },
): Promise<PersonalAiConfig> {
  return readPersonalAiConfig(await request<unknown>("/workspace/personal-ai/config", {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function fetchPersonalAiModels(
  token: string,
  payload: { provider: string; apiKey?: string },
): Promise<PersonalAiModelList> {
  return readPersonalAiModelList(await request<unknown>("/workspace/personal-ai/models", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function testPersonalAiConnection(token: string): Promise<PersonalAiConnectionTest> {
  return readPersonalAiConnectionTest(await request<unknown>("/workspace/personal-ai/test", {
    method: "POST",
    headers: authHeaders(token),
  }));
}

export async function sendPersonalAiChat(
  token: string,
  payload: { messages: PersonalAiChatMessage[] },
): Promise<PersonalAiChatResponse> {
  return readPersonalAiChatResponse(await request<unknown>("/workspace/personal-ai/chat", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
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

export async function fetchScheduledMail(token: string, options?: MailListQuery): Promise<MailListResponse> {
  const query = new URLSearchParams();
  if (options?.q?.trim()) query.set("q", options.q.trim());
  if (options?.sort) query.set("sort", options.sort);
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  if (options?.offset !== undefined) query.set("offset", String(options.offset));
  const suffix = query.toString();
  return request<MailListResponse>(`/mail/scheduled${suffix ? `?${suffix}` : ""}`, { headers: authHeaders(token) });
}

export async function updateScheduledMail(token: string, mailId: string, payload: MailComposePayload): Promise<MailDetail> {
  return request<MailDetail>(`/mail/${mailId}/scheduled`, { method: "PUT", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, confirmed: true }) });
}

export async function cancelScheduledMail(token: string, mailId: string): Promise<{ mailId: string; status: string }> {
  return request(`/mail/${mailId}/scheduled`, { method: "DELETE", headers: authHeaders(token) });
}

export async function sendScheduledMailNow(token: string, mailId: string): Promise<{ mailId: string; status: string }> {
  return request(`/mail/${mailId}/scheduled/send-now`, { method: "POST", headers: authHeaders(token) });
}

export async function retryScheduledMail(token: string, mailId: string): Promise<{ mailId: string; status: string }> {
  return request(`/mail/${mailId}/scheduled/retry`, { method: "POST", headers: authHeaders(token) });
}

export async function fetchMailStorage(token: string): Promise<MailStorageResponse> {
  return request<MailStorageResponse>("/mail/storage", {
    headers: authHeaders(token),
  });
}

// UI-024 mailbox settings
export async function fetchMailboxSettings(token: string): Promise<MailMailboxSettingsResponse> {
  return request<MailMailboxSettingsResponse>("/mail/mailbox-settings", {
    headers: authHeaders(token),
  });
}

export async function updateMailboxPolicy(
  token: string,
  mailbox: MailboxSettingsRow,
  retentionDays: MailboxSettingsRow["retentionDays"],
): Promise<MailboxSettingsRow> {
  return request<MailboxSettingsRow>(`/mail/mailbox-settings/${encodeURIComponent(mailbox.mailboxKey)}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ retentionDays, expectedVersion: mailbox.version }),
  });
}

export async function emptyMailbox(
  token: string,
  mailbox: MailboxSettingsRow,
  confirmPermanent: boolean,
): Promise<MailMailboxEmptyResponse> {
  return request<MailMailboxEmptyResponse>(`/mail/mailbox-settings/${encodeURIComponent(mailbox.mailboxKey)}/empty`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ expectedCount: mailbox.totalCount, confirmPermanent }),
  });
}

export async function createMailboxBackup(token: string, mailboxKey: string): Promise<MailBackupJob> {
  return request<MailBackupJob>("/mail/mailbox-backups", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ mailboxKey }),
  });
}

export async function fetchMailboxBackups(token: string): Promise<{ jobs: MailBackupJob[] }> {
  return request<{ jobs: MailBackupJob[] }>("/mail/mailbox-backups", {
    headers: authHeaders(token),
  });
}

export async function retryMailboxBackup(token: string, jobId: string): Promise<MailBackupJob> {
  return request<MailBackupJob>(`/mail/mailbox-backups/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function mailboxBackupDownloadUrl(jobId: string): string {
  return `/api/v1/mail/mailbox-backups/${encodeURIComponent(jobId)}/download`;
}

export async function downloadMailboxBackup(token: string, job: MailBackupJob): Promise<void> {
  const response = await fetch(mailboxBackupDownloadUrl(job.jobId), {
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
    anchor.download = `${job.mailboxLabel}-backup.zip`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// UI-025 spam settings
export async function fetchSpamSettings(token: string): Promise<MailSpamSettingsResponse> {
  return request<MailSpamSettingsResponse>("/mail/spam-settings", {
    headers: authHeaders(token),
  });
}

export async function updateSpamSettings(
  token: string,
  settings: MailSpamSettingsResponse,
): Promise<MailSpamSettingsResponse> {
  return request<MailSpamSettingsResponse>("/mail/spam-settings", {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({
      filterEnabled: settings.filterEnabled,
      blockedAction: settings.blockedAction,
      expectedVersion: settings.version,
    }),
  });
}

export async function createSpamRule(token: string, payload: MailSpamRulePayload): Promise<MailSpamRule> {
  return request<MailSpamRule>("/mail/spam-settings/rules", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function updateSpamRule(token: string, ruleId: string, payload: MailSpamRulePayload): Promise<MailSpamRule> {
  return request<MailSpamRule>(`/mail/spam-settings/rules/${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function deleteSpamRule(token: string, ruleId: string): Promise<void> {
  await request<Record<string, never>>(`/mail/spam-settings/rules/${encodeURIComponent(ruleId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

// UI-026 auto classification
export async function fetchAutoClassificationSettings(token: string): Promise<MailAutoClassificationSettings> {
  return request<MailAutoClassificationSettings>("/mail/settings/auto-classification", { headers: authHeaders(token) });
}
export async function updateAutoClassificationSettings(token: string, settings: MailAutoClassificationSettings): Promise<MailAutoClassificationSettings> {
  return request<MailAutoClassificationSettings>("/mail/settings/auto-classification", { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ enabled: settings.enabled, version: settings.version }) });
}
export async function createAutoClassificationRule(token: string, payload: MailAutoClassificationRulePayload): Promise<MailAutoClassificationRule> {
  return request<MailAutoClassificationRule>("/mail/settings/auto-classification/rules", { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) });
}
export async function updateAutoClassificationRule(token: string, rule: MailAutoClassificationRule, payload: MailAutoClassificationRulePayload): Promise<MailAutoClassificationRule> {
  return request<MailAutoClassificationRule>(`/mail/settings/auto-classification/rules/${encodeURIComponent(rule.ruleId)}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ ...payload, version: rule.version }) });
}
export async function deleteAutoClassificationRule(token: string, ruleId: string): Promise<void> {
  await request<Record<string, never>>(`/mail/settings/auto-classification/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE", headers: authHeaders(token) });
}
export async function deleteAutoClassificationRules(token: string, ruleIds: string[]): Promise<void> {
  await request<Record<string, never>>("/mail/settings/auto-classification/rules/delete", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ruleIds }) });
}
export async function reorderAutoClassificationRules(token: string, settings: MailAutoClassificationSettings, ruleIds: string[]): Promise<MailAutoClassificationSettings> {
  return request<MailAutoClassificationSettings>("/mail/settings/auto-classification/rules/order", { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ ruleIds, version: settings.version }) });
}

export async function fetchAutoForwardSettings(token: string): Promise<MailAutoForwardSettings> {
  return request<MailAutoForwardSettings>("/mail/settings/auto-forwarding", { headers: authHeaders(token) });
}
export async function updateAutoForwardSettings(token: string, value: MailAutoForwardSettings): Promise<MailAutoForwardSettings> {
  return request<MailAutoForwardSettings>("/mail/settings/auto-forwarding", { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ enabled: value.enabled, keepOriginal: value.keepOriginal, version: value.version }) });
}
export async function createAutoForwardTargets(token: string, emails: string[]): Promise<MailAutoForwardTarget[]> {
  return request<MailAutoForwardTarget[]>("/mail/settings/auto-forwarding/targets", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ emails }) });
}
export async function deleteAutoForwardTargets(token: string, targetIds: string[]): Promise<void> {
  await request<Record<string, never>>("/mail/settings/auto-forwarding/targets/delete", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ targetIds }) });
}
export async function createAutoForwardException(token: string, payload: MailAutoForwardExceptionPayload): Promise<MailAutoForwardException> {
  return request<MailAutoForwardException>("/mail/settings/auto-forwarding/exceptions", { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) });
}
export async function updateAutoForwardException(token: string, item: MailAutoForwardException, payload: MailAutoForwardExceptionPayload): Promise<MailAutoForwardException> {
  return request<MailAutoForwardException>(`/mail/settings/auto-forwarding/exceptions/${encodeURIComponent(item.exceptionId)}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ ...payload, version: item.version }) });
}
export async function deleteAutoForwardExceptions(token: string, exceptionIds: string[]): Promise<void> {
  await request<Record<string, never>>("/mail/settings/auto-forwarding/exceptions/delete", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ exceptionIds }) });
}

export async function fetchOutOfOfficeSettings(token: string): Promise<MailOutOfOfficeSettings> {
  return request<MailOutOfOfficeSettings>("/mail/settings/out-of-office", { headers: authHeaders(token) });
}

export async function updateOutOfOfficeSettings(token: string, value: MailOutOfOfficeSettings): Promise<MailOutOfOfficeSettings> {
  return request<MailOutOfOfficeSettings>("/mail/settings/out-of-office", {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({
      enabled: value.enabled,
      startDate: value.startDate,
      endDate: value.endDate,
      subject: value.subject,
      message: value.message,
      targetScope: value.targetScope,
      version: value.version,
    }),
  });
}

export async function fetchExternalMailAccounts(token: string): Promise<MailExternalAccountList> {
  return request<MailExternalAccountList>("/mail/settings/external-accounts", { headers: authHeaders(token) });
}
export async function createExternalMailAccount(token: string, payload: MailExternalAccountPayload): Promise<MailExternalAccount> {
  return request<MailExternalAccount>("/mail/settings/external-accounts", { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) });
}
export async function updateExternalMailAccount(token: string, id: string, payload: MailExternalAccountPayload): Promise<MailExternalAccount> {
  return request<MailExternalAccount>(`/mail/settings/external-accounts/${encodeURIComponent(id)}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(payload) });
}
export async function deleteExternalMailAccount(token: string, id: string): Promise<void> {
  await request<void>(`/mail/settings/external-accounts/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders(token) });
}
export async function bulkDeleteExternalMailAccounts(token: string, ids: string[]): Promise<void> {
  await request<void>("/mail/settings/external-accounts/bulk-delete", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ accountIds: ids }) });
}
export async function testExternalMailAccount(token: string, id: string): Promise<MailExternalAccount> {
  return request<MailExternalAccount>(`/mail/settings/external-accounts/${encodeURIComponent(id)}/test`, { method: "POST", headers: authHeaders(token) });
}
export async function collectExternalMailAccount(token: string, id: string): Promise<{ jobId: string; status: "queued" }> {
  return request(`/mail/settings/external-accounts/${encodeURIComponent(id)}/collect`, { method: "POST", headers: authHeaders(token) });
}

export type MailBasicPreferences = {
  senderDisplayMode: "name" | "id" | "name_email";
  blockRemoteImages: boolean;
  disableRiskyTags: boolean;
  showRouteCountry: boolean;
  includeSpamTrashInSearch: boolean;
  showListPreview: boolean;
  recipientInputMode: "autocomplete" | "name_only" | "search";
  confirmBeforeSend: boolean;
  saveSentCopy: boolean;
  readReceiptEnabled: boolean;
  editorMode: "html" | "plain";
  composeMode: "normal" | "popup";
  messageEncoding: "utf-8" | "euc-kr" | "iso-2022-jp";
  draftReminderEnabled: boolean;
  senderDisplayName: string;
  replyToEmail: string | null;
  vcardEnabled: boolean;
  translationTargetLocale: string;
  translationComposeMode: "preview" | "apply";
  version: number;
  updatedAt: string;
};

export async function fetchMailBasicPreferences(token: string): Promise<MailBasicPreferences> {
  return request<MailBasicPreferences>("/mail/preferences/basic", { headers: authHeaders(token) });
}

export async function updateMailBasicPreferences(token: string, preferences: MailBasicPreferences): Promise<MailBasicPreferences> {
  return request<MailBasicPreferences>("/mail/preferences/basic", {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ...preferences, expectedVersion: preferences.version }),
  });
}

export async function resetMailBasicPreferences(token: string): Promise<MailBasicPreferences> {
  return request<MailBasicPreferences>("/mail/preferences/basic/reset", { method: "POST", headers: authHeaders(token) });
}

export type MailSignature = {
  signatureId: string;
  name: string;
  contentText: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MailSignaturePreferences = {
  enabled: boolean;
  position: "body_top" | "body_bottom";
  defaultSignatureId: string | null;
  version: number;
  updatedAt: string;
  signatures: MailSignature[];
};

export async function fetchMailSignatures(token: string): Promise<MailSignaturePreferences> {
  return request<MailSignaturePreferences>("/mail/signatures", { headers: authHeaders(token) });
}

export async function createMailSignature(token: string, payload: { name: string; contentText: string; makeDefault: boolean }): Promise<MailSignature> {
  return request<MailSignature>("/mail/signatures", {
    method: "POST", headers: authHeaders(token), body: JSON.stringify(payload),
  });
}

export async function updateMailSignature(token: string, signature: MailSignature, payload: { name: string; contentText: string }): Promise<MailSignature> {
  return request<MailSignature>(`/mail/signatures/${encodeURIComponent(signature.signatureId)}`, {
    method: "PUT", headers: authHeaders(token),
    body: JSON.stringify({ ...payload, expectedVersion: signature.version }),
  });
}

export async function deleteMailSignature(token: string, signature: MailSignature): Promise<MailSignaturePreferences> {
  return request<MailSignaturePreferences>(`/mail/signatures/${encodeURIComponent(signature.signatureId)}?expectedVersion=${signature.version}`, {
    method: "DELETE", headers: authHeaders(token),
  });
}

export async function bulkDeleteMailSignatures(token: string, signatures: MailSignature[]): Promise<MailSignaturePreferences> {
  return request<MailSignaturePreferences>("/mail/signatures/bulk-delete", {
    method: "POST", headers: authHeaders(token),
    body: JSON.stringify({ items: signatures.map((item) => ({ signatureId: item.signatureId, expectedVersion: item.version })) }),
  });
}

export async function updateMailSignaturePreferences(token: string, preferences: MailSignaturePreferences): Promise<MailSignaturePreferences> {
  return request<MailSignaturePreferences>("/mail/signatures/preferences", {
    method: "PUT", headers: authHeaders(token),
    body: JSON.stringify({
      enabled: preferences.enabled,
      position: preferences.position,
      defaultSignatureId: preferences.defaultSignatureId,
      expectedVersion: preferences.version,
    }),
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
  trashViews?: Array<{ mailId: string; sourceMailbox: "inbox" | "sent" | "draft" }>,
): Promise<MailBulkResponse> {
  return request<MailBulkResponse>("/mail/bulk", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ mailIds, action, mailbox, ...(targetCategory ? { targetCategory } : {}),
      ...(targetFolderId ? { targetFolderId } : {}), ...(targetTagId ? { targetTagId } : {}),
      ...(trashViews ? { trashViews } : {}) }),
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
  provider: {
    enabled: boolean;
    lastTestStatus: string;
  };
};

export type MailRecentRecipient = {
  recipientId: string | null;
  email: string;
  name: string | null;
  departmentName: string | null;
  lastUsedAt: string;
  useCount: number;
};

export type MailRecentRecipientSettingsResponse = {
  recipients: MailRecentRecipient[];
  totalCount: number;
};

export type MailRecentRecipientDeleteResponse = {
  requestedCount: number;
  changedCount: number;
};

export async function fetchRecentMailRecipients(token: string, limit = 20): Promise<{ recipients: MailRecentRecipient[] }> {
  return request<{ recipients: MailRecentRecipient[] }>(`/mail/recent-recipients?limit=${limit}`, {
    headers: authHeaders(token),
  });
}

export async function fetchRecentMailRecipientSettings(token: string): Promise<MailRecentRecipientSettingsResponse> {
  return request<MailRecentRecipientSettingsResponse>("/mail/settings/recent-recipients", {
    headers: authHeaders(token),
  });
}

export async function deleteRecentMailRecipient(token: string, recipientId: string): Promise<MailRecentRecipientDeleteResponse> {
  return request<MailRecentRecipientDeleteResponse>(`/mail/settings/recent-recipients/${recipientId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function bulkDeleteRecentMailRecipients(
  token: string,
  payload: { recipientIds?: string[]; deleteAll?: boolean },
): Promise<MailRecentRecipientDeleteResponse> {
  return request<MailRecentRecipientDeleteResponse>("/mail/settings/recent-recipients/bulk-delete", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function uploadMailAttachment(
  token: string,
  file: File,
  disposition: MailUploadDisposition = "attachment",
): Promise<MailAttachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("disposition", disposition);
  return request<MailAttachment>("/mail/attachments", {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
}

function assertMailPreviewPath(previewPath: string): void {
  if (!previewPath.startsWith("/mail/") || /[\\%?#\u0000-\u001f\u007f]/.test(previewPath)) {
    throw new Error("허용되지 않은 메일 이미지 미리보기 경로입니다.");
  }
  const segments = previewPath.split("/");
  if (
    segments[0] !== "" ||
    segments[1] !== "mail" ||
    segments.slice(2).some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/.test(segment))
  ) {
    throw new Error("허용되지 않은 메일 이미지 미리보기 경로입니다.");
  }
}

function resolveMailPreviewUrl(previewPath: string): string {
  assertMailPreviewPath(previewPath);
  const expectedPathname = `${apiBase}${previewPath}`;
  const resolved = new URL(expectedPathname, window.location.origin);
  if (
    resolved.origin !== window.location.origin ||
    resolved.pathname !== expectedPathname ||
    resolved.search ||
    resolved.hash
  ) {
    throw new Error("허용되지 않은 메일 이미지 미리보기 경로입니다.");
  }
  return resolved.href;
}

export async function fetchMailInlinePreview(token: string, previewPath: string): Promise<Blob> {
  const previewUrl = resolveMailPreviewUrl(previewPath);
  const response = await fetch(previewUrl, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw extractApiError(response, data);
  }
  return response.blob();
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

export async function updateMailDraft(token: string, mailId: string, payload: MailDraftUpdatePayload): Promise<MailDetail> {
  return request<MailDetail>(`/mail/${mailId}/draft`, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
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

export async function createMessengerRoom(token: string, payload: { roomName: string; roomType?: string; participantUserIds: string[]; translationLocale: MessengerRoomSummary["translationLocale"] }) {
  return request<MessengerRoomDetail>("/messenger/rooms", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ roomName: payload.roomName, roomType: payload.roomType ?? "group", participantUserIds: payload.participantUserIds, translationLocale: payload.translationLocale }),
  });
}

export async function favoriteMessengerRoom(token: string, roomId: string, isFavorite: boolean) {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}/favorite`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ isFavorite }),
  });
}

export async function updateMessengerRoomTranslation(token: string, roomId: string, translationLocale: MessengerRoomSummary["translationLocale"], expectedUpdatedAt: string) {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}/translation`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ translationLocale, expectedUpdatedAt }),
  });
}

export async function updateMessengerRoomParticipants(token: string, roomId: string, participantUserIds: string[], expectedUpdatedAt: string) {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}/participants`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ participantUserIds, expectedUpdatedAt }),
  });
}

export async function transferMessengerRoomOwner(token: string, roomId: string, newOwnerUserId: string, expectedUpdatedAt: string) {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}/owner`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ newOwnerUserId, expectedUpdatedAt }),
  });
}

export async function leaveMessengerRoom(token: string, roomId: string) {
  return request<{ roomId: string; leftAt: string }>(`/messenger/rooms/${roomId}/leave`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function deleteMessengerRoom(token: string, roomId: string) {
  return request<{ roomId: string; status: string; deletedAt: string; retentionExpiresAt: string }>(`/messenger/rooms/${roomId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function fetchMessengerRoom(token: string, roomId: string): Promise<MessengerRoomDetail> {
  return request<MessengerRoomDetail>(`/messenger/rooms/${roomId}`, {
    headers: authHeaders(token),
  });
}

export async function fetchMessengerMessages(token: string, roomId: string, before?: string): Promise<MessengerMessageListResponse> {
  const suffix = before ? `?limit=100&before=${encodeURIComponent(before)}` : "?limit=100";
  return request<MessengerMessageListResponse>(`/messenger/rooms/${roomId}/messages${suffix}`, {
    headers: authHeaders(token),
  });
}

export async function sendMessengerMessage(
  token: string,
  roomId: string,
  payload: { body: string; messageType?: "text" | "file"; attachments?: MessengerAttachment[] },
): Promise<MessengerMessageSendResponse> {
  return request<MessengerMessageSendResponse>(`/messenger/rooms/${roomId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      body: payload.body,
      messageType: payload.messageType ?? "text",
      attachments: payload.attachments ?? [],
      attachmentMeta: [],
    }),
  });
}

export async function uploadMessengerAttachment(token: string, file: File): Promise<MessengerAttachment> {
  const form = new FormData();
  form.append("file", file);
  return request<MessengerAttachment>("/messenger/attachments", { method: "POST", headers: authHeaders(token), body: form });
}

export async function downloadMessengerAttachment(token: string, roomId: string, messageId: string, attachment: MessengerAttachmentView): Promise<void> {
  const response = await fetch(`${apiBase}/messenger/rooms/${roomId}/messages/${messageId}/attachments/${attachment.attachmentId}`, { headers: authHeaders(token) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw extractApiError(response, data);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = attachment.fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function readMessengerRoom(token: string, roomId: string): Promise<MessengerReadResponse> {
  return request<MessengerReadResponse>(`/messenger/rooms/${roomId}/read`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export type WorkspaceScheduleAttendee = { userId: string; name: string; email: string; department: string };
export type CalendarVisibility = "public" | "approval_required" | "private";
export type WorkspaceCalendar = { id: string; name: string; color: string; sortOrder: number; isDefault: boolean; visibility: CalendarVisibility; version: number; ownerUserId: string; ownerUserName: string; activeScheduleCount: number };
export type WorkspaceCalendarSubscription = { subscriptionId: string; status: "pending" | "active"; version: number; calendar: WorkspaceCalendar };
export type WorkspaceCalendarIncoming = WorkspaceCalendarSubscription & { subscriber: { userId: string; name: string; email: string; department: string } };
export type WorkspaceCalendarData = { owned: WorkspaceCalendar[]; subscriptions: WorkspaceCalendarSubscription[]; incomingRequests: WorkspaceCalendarIncoming[] };
export type WorkspaceSchedule = { id: string; title: string; starts_at: string; ends_at: string; description: string; location: string; attendees: WorkspaceScheduleAttendee[]; repeatType: "none" | "daily" | "weekly" | "monthly"; repeatUntil: string | null; alertMinutes: number[]; timezone: string; calendarId: string; calendarName: string; calendarColor: string; ownerUserId: string; ownerUserName: string; canEdit: boolean; occurrence_key?: string; status: string; created_at: string; updated_at: string };
export type WorkspaceSchedulePayload = { title: string; startsAt: string; endsAt: string; description: string; location: string; attendeeUserIds: string[]; repeatType: "none" | "daily" | "weekly" | "monthly"; repeatUntil: string | null; alertMinutes: number[]; timezone: string; calendarId: string };
export type WorkspaceContact = { id: string; name: string; email: string; phone: string; company_name: string; memo: string; group_id: string | null; group_name: string | null; status: string; created_at: string; updated_at: string };
export type ContactGroup = { id: string; name: string; sortOrder: number; contactCount: number; status: string; createdAt: string; updatedAt: string };
export type PublicContact = { id: string; name: string; email: string; department_name: string; role_name: string };
export type ContactImportPreview = { digest: string; totalRows: number; newCount: number; existingEmailCount: number; fileDuplicateCount: number; groupsToCreate: string[]; errors: Array<{ rowNumber: number; message: string }>; canApply: boolean };
export type ContactImportResult = { digest: string; createdCount: number; skippedCount: number; groupCount: number };
export type WorkspaceFileScope = "mine" | "shared" | "department" | "recent" | "favorites" | "trash";
export type WorkspaceFilePermission = { download: boolean; favorite: boolean; rename: boolean; newVersion: boolean; move: boolean; share: boolean; trash: boolean; restore: boolean };
export type WorkspaceFile = { id: string; file_name: string; content_type: string; size_bytes: number; status: string; folderId?: string | null; currentVersion?: number; version?: number; isFavorite?: boolean; owner_user_id?: string; permissions?: WorkspaceFilePermission; created_at: string; updated_at: string };
export type WorkspaceFileDetail = WorkspaceFile & { versions: Array<{ version_no: number; file_name: string; content_type: string; size_bytes: number; created_at: string }>; shares: Array<{ target_type: "user" | "department"; target_id: string; target_name?: string; permission: "viewer" | "editor" }>; activity: Array<{ actor_user_name: string; event: string; created_at: string }> };
export type WorkspaceFolder = { id: string; parent_id?: string | null; parentId?: string | null; name: string; version: number };
export type WorkspaceDirectory = { departments: Array<{ id: string; name: string; parent_id: string | null; department_code: string | null }>; users: Array<{ id: string; name: string; email: string; department_name: string; role_name: string }> };
export type OrganizationDepartment = { id: string; name: string; departmentCode: string | null; parentId: string | null; directMemberCount: number };
export type OrganizationMember = { id: string; name: string; email: string; departmentId: string | null; departmentName: string; roleName: string };
export type WorkspaceProfile = {
  userId: string; name: string; email: string; companyName: string; departmentName: string; roleName: string;
  externalEmail: string; mobilePhone: string; officePhone: string; introduction: string; postalCode: string;
  addressLine1: string; addressLine2: string; memo: string; anniversary: string | null; photoAvailable: boolean; version: number;
};
export type PersonalProfilePayload = Pick<WorkspaceProfile, "externalEmail" | "mobilePhone" | "officePhone" | "introduction" | "postalCode" | "addressLine1" | "addressLine2" | "memo" | "anniversary"> & { expectedVersion: number };
export type WorkspacePreferences = { locale: string; timezone: string; startPage: "home" | "mail" | "approval" | "messenger" | "schedule" | "contacts" | "org" | "files"; version: number };
export type WorkspaceHelpPolicy = { id: string; code: string; title: string; category: string; audience: string; content: string; version: number; published_at: string; updated_at: string };
export type WorkspaceNotice = { id: string; title: string; content: string; author_name: string; published_at: string; is_read: boolean };
export async function fetchWorkspaceDirectory(token: string) { return request<WorkspaceDirectory>("/workspace/directory", { headers: authHeaders(token) }); }
export async function fetchOrganizationDepartments(token: string) { return request<{ departments: OrganizationDepartment[] }>("/workspace/organization/departments", { headers: authHeaders(token) }); }
export async function fetchOrganizationMembers(token: string, options: { departmentId?: string; query?: string } = {}) { const params = new URLSearchParams(); if (options.departmentId) params.set("departmentId", options.departmentId); if (options.query) params.set("query", options.query); const suffix = params.size ? `?${params}` : ""; const path = "/workspace/organization/members"; return request<{ members: OrganizationMember[] }>(`${path}${suffix}`, { headers: authHeaders(token) }); }
export async function fetchOrganizationMemberDetail(token: string, userId: string) { return request<OrganizationMember>(`/workspace/organization/members/${encodeURIComponent(userId)}`, { headers: authHeaders(token) }); }
export async function fetchCalendars(token: string) { return request<WorkspaceCalendarData>("/workspace/calendars", { headers: authHeaders(token) }); }
export async function discoverCalendars(token: string, query: string) { return request<{ items: WorkspaceCalendar[] }>(`/workspace/calendars/discover?query=${encodeURIComponent(query)}`, { headers: authHeaders(token) }); }
export async function createCalendar(token: string, payload: { name: string; color: string }) { return request<WorkspaceCalendar>("/workspace/calendars", { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function updateCalendar(token: string, id: string, payload: { name?: string; color?: string; visibility?: CalendarVisibility; isDefault?: boolean; expectedVersion: number }) { return request<WorkspaceCalendar>(`/workspace/calendars/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function reorderCalendars(token: string, calendars: WorkspaceCalendar[]) { return request<WorkspaceCalendarData>("/workspace/calendars/order", { method: "PUT", headers: authHeaders(token), body: JSON.stringify({ items: calendars.map((calendar) => ({ calendarId: calendar.id, expectedVersion: calendar.version })) }) }); }
export async function deleteCalendar(token: string, calendar: WorkspaceCalendar) { return request<void>(`/workspace/calendars/${calendar.id}?expectedVersion=${calendar.version}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function createCalendarSubscription(token: string, calendarId: string) { return request<WorkspaceCalendarSubscription>("/workspace/calendar-subscriptions", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ calendarId }) }); }
export async function cancelCalendarSubscription(token: string, subscriptionId: string) { return request<void>(`/workspace/calendar-subscriptions/${subscriptionId}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function decideCalendarSubscription(token: string, subscriptionId: string, decision: "accept" | "reject") { return request<{ subscriptionId: string; status: string }>(`/workspace/calendar-subscriptions/${subscriptionId}/${decision}`, { method: "POST", headers: authHeaders(token) }); }
export async function fetchSchedules(token: string) { return request<{ items: WorkspaceSchedule[] }>("/workspace/schedules", { headers: authHeaders(token) }); }
export async function saveSchedule(token: string, payload: WorkspaceSchedulePayload, id?: string) { return request<WorkspaceSchedule>(`/workspace/schedules${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function deleteSchedule(token: string, id: string) { return request<void>(`/workspace/schedules/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchContacts(token: string, query = "", groupId: string | null = null) { const params = new URLSearchParams(); if (query) params.set("query", query); if (groupId) params.set("groupId", groupId); const suffix = params.size ? `?${params}` : ""; return request<{ items: WorkspaceContact[] }>(`/workspace/contacts${suffix}`, { headers: authHeaders(token) }); }
export async function saveContact(token: string, payload: { name: string; email: string; phone: string; companyName: string; memo: string; groupId?: string | null }, id?: string) { return request<WorkspaceContact>(`/workspace/contacts${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function deleteContact(token: string, id: string) { return request<void>(`/workspace/contacts/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchContactGroups(token: string) { return request<{ items: ContactGroup[] }>("/workspace/contact-groups", { headers: authHeaders(token) }); }
export async function createContactGroup(token: string, name: string) { return request<ContactGroup>("/workspace/contact-groups", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ name }) }); }
export async function updateContactGroup(token: string, groupId: string, name: string, expectedUpdatedAt: string) { return request<ContactGroup>(`/workspace/contact-groups/${groupId}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ name, expectedUpdatedAt }) }); }
export async function deleteContactGroup(token: string, groupId: string, expectedUpdatedAt: string) { const params = new URLSearchParams({ expectedUpdatedAt }); return request<void>(`/workspace/contact-groups/${groupId}?${params}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchPublicContacts(token: string, query = "") { const params = new URLSearchParams(); if (query) params.set("query", query); const suffix = params.size ? `?${params}` : ""; return request<{ items: PublicContact[] }>(`/workspace/public-contacts${suffix}`, { headers: authHeaders(token) }); }
export async function previewContactImport(token: string, file: File) { const form = new FormData(); form.append("file", file); return request<ContactImportPreview>("/workspace/contacts/import?mode=preview", { method: "POST", headers: authHeaders(token), body: form }); }
export async function applyContactImport(token: string, file: File, expectedDigest: string) { const form = new FormData(); form.append("file", file); const params = new URLSearchParams({ mode: "apply", expectedDigest }); return request<ContactImportResult>(`/workspace/contacts/import?${params}`, { method: "POST", headers: authHeaders(token), body: form }); }
export async function fetchWorkspaceFiles(token: string, options: { scope?: WorkspaceFileScope; folderId?: string | null; query?: string; sort?: string } = {}) { const params = new URLSearchParams(); if (options.scope) params.set("scope", options.scope); if (Object.prototype.hasOwnProperty.call(options, "folderId")) params.set("folderId", options.folderId ?? ""); if (options.query) params.set("query", options.query); if (options.sort) params.set("sort", options.sort); return request<{ items: WorkspaceFile[] }>(`/workspace/files${params.size ? `?${params}` : ""}`, { headers: authHeaders(token) }); }
export async function fetchWorkspaceFileDetail(token: string, id: string, includeDeleted = false) { const suffix = includeDeleted ? "?includeDeleted=true" : ""; return request<WorkspaceFileDetail>(`/workspace/files/${id}${suffix}`, { headers: authHeaders(token) }); }
export async function fetchWorkspaceFolders(token: string) { return request<{ items: WorkspaceFolder[] }>("/workspace/file-folders", { headers: authHeaders(token) }); }
export async function uploadWorkspaceFile(token: string, file: File, folderId?: string | null) { const form = new FormData(); form.append("file", file); const params = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""; return request<WorkspaceFile>(`/workspace/files${params}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }); }
export async function renameWorkspaceFile(token: string, id: string, fileName: string, expectedVersion?: number) { return request<WorkspaceFile>(`/workspace/files/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ fileName, expectedVersion }) }); }
export async function moveWorkspaceFile(token: string, id: string, folderId: string | null, expectedVersion: number) { return request<WorkspaceFile>(`/workspace/files/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ folderId, expectedVersion }) }); }
export async function deleteWorkspaceFile(token: string, id: string, expectedVersion?: number) { const suffix = expectedVersion === undefined ? "" : `?expectedVersion=${expectedVersion}`; return request<void>(`/workspace/files/${id}${suffix}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function restoreWorkspaceFile(token: string, id: string, expectedVersion: number) { return request<WorkspaceFile>(`/workspace/files/${id}/restore?expectedVersion=${expectedVersion}`, { method: "POST", headers: authHeaders(token) }); }
export async function favoriteWorkspaceFile(token: string, id: string, enabled: boolean) { return request<{ isFavorite: boolean }>(`/workspace/files/${id}/favorite`, { method: enabled ? "PUT" : "DELETE", headers: authHeaders(token) }); }
export async function uploadWorkspaceFileVersion(token: string, id: string, file: File, expectedVersion: number) { const form = new FormData(); form.append("file", file); return request<WorkspaceFileDetail>(`/workspace/files/${id}/versions?expectedVersion=${expectedVersion}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }); }
export async function saveWorkspaceFileShares(token: string, id: string, expectedVersion: number, shares: WorkspaceFileDetail["shares"]) { return request<WorkspaceFileDetail>(`/workspace/files/${id}/shares`, { method: "PUT", headers: authHeaders(token), body: JSON.stringify({ expectedVersion, shares: shares.map((share) => ({ targetType: share.target_type, targetId: share.target_id, permission: share.permission })) }) }); }
export async function createWorkspaceFolder(token: string, name: string, parentId: string | null) { return request<WorkspaceFolder>("/workspace/file-folders", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ name, parentId }) }); }
export async function renameWorkspaceFolder(token: string, id: string, name: string, expectedVersion: number) { return request<WorkspaceFolder>(`/workspace/file-folders/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ name, expectedVersion }) }); }
export async function deleteWorkspaceFolder(token: string, id: string, expectedVersion: number) { return request<void>(`/workspace/file-folders/${id}?expectedVersion=${expectedVersion}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function downloadWorkspaceFile(token: string, file: WorkspaceFile, version?: number) { const suffix = version ? `?version=${version}` : ""; const response = await fetch(`${apiBase}/workspace/files/${file.id}/download${suffix}`, { headers: authHeaders(token) }); if (!response.ok) throw extractApiError(response, await response.json().catch(() => ({}))); const objectUrl = URL.createObjectURL(await response.blob()); try { const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = file.file_name; anchor.click(); } finally { URL.revokeObjectURL(objectUrl); } }
export async function fetchWorkspaceProfile(token: string) { return request<WorkspaceProfile>("/workspace/profile", { headers: authHeaders(token) }); }
export async function saveWorkspaceProfile(token: string, payload: PersonalProfilePayload) { return request<WorkspaceProfile>("/workspace/profile", { method: "PUT", headers: authHeaders(token), body: JSON.stringify(payload) }); }
export async function fetchWorkspaceProfilePhoto(token: string) {
  const response = await fetch(`${apiBase}/workspace/profile/photo`, { headers: authHeaders(token), cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw extractApiError(response, await response.json().catch(() => ({})));
  return response.blob();
}
export async function saveWorkspaceProfilePhoto(token: string, file: File, expectedVersion: number) {
  const form = new FormData(); form.append("file", file);
  return request<WorkspaceProfile>(`/workspace/profile/photo?expectedVersion=${expectedVersion}`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form });
}
export async function deleteWorkspaceProfilePhoto(token: string, expectedVersion: number) { return request<WorkspaceProfile>(`/workspace/profile/photo?expectedVersion=${expectedVersion}`, { method: "DELETE", headers: authHeaders(token) }); }
export async function fetchWorkspacePreferences(token: string) { return request<WorkspacePreferences>("/workspace/preferences", { headers: authHeaders(token) }); }
export async function saveWorkspacePreferences(token: string, payload: WorkspacePreferences) { return request<WorkspacePreferences>("/workspace/preferences", { method: "PUT", headers: authHeaders(token), body: JSON.stringify({ locale: payload.locale, timezone: payload.timezone, startPage: payload.startPage, expectedVersion: payload.version }) }); }
export async function fetchWorkspaceHelpPolicies(token: string, options: { query?: string; category?: string } = {}) { const params = new URLSearchParams(); if (options.query) params.set("query", options.query); if (options.category) params.set("category", options.category); return request<{ items: WorkspaceHelpPolicy[] }>(`/workspace/help-policies${params.size ? `?${params}` : ""}`, { headers: authHeaders(token) }); }
export async function fetchWorkspaceNotices(token: string) { return request<{ items: WorkspaceNotice[]; unread_count: number }>("/workspace/notices", { headers: authHeaders(token) }); }
export async function fetchWorkspaceNotice(token: string, id: string) { return request<WorkspaceNotice>(`/workspace/notices/${id}`, { headers: authHeaders(token) }); }
export async function readWorkspaceNotice(token: string, id: string) { return request<WorkspaceNotice>(`/workspace/notices/${id}/read`, { method: "POST", headers: authHeaders(token) }); }
