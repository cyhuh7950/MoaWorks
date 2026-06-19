const fallbackApiBase = `${window.location.protocol}//${window.location.hostname}:8010/api/v1`;
export const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  window.localStorage.getItem("moaworks.apiBase") ??
  fallbackApiBase;

const tokenStorageKey = "moaworks.userToken";

export type ApiError = {
  code: string;
  userMessage: string;
};

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

export type MeResponse = {
  user: AuthUser;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof data === "object" && data && "userMessage" in data ? String((data as ApiError).userMessage) : "요청 처리 실패";
    throw new Error(message);
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

export async function fetchNotifications(token: string, options?: { unreadOnly?: boolean; severity?: string[]; category?: "approval" | "mail" | "system"; cursor?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (options?.unreadOnly !== undefined) query.append("unreadOnly", String(options.unreadOnly));
  if (options?.category) query.append("category", options.category);
  if (options?.cursor) query.append("cursor", options.cursor);
  if (options?.limit) query.append("limit", String(options.limit));
  if (options?.severity?.length) {
    options.severity.forEach((value) => query.append("severity", value));
  }
  const qs = query.toString();
  return request<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(token),
  });
}

export async function ackNotification(token: string, notificationId: string) {
  return request<NotificationRecord>(`/notifications/${notificationId}/ack`, {
    method: "POST",
    headers: authHeaders(token),
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
