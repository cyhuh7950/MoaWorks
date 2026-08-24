export type HealthComponent = {
  status: string;
  message: string;
  details: Record<string, string>;
};

export type HealthResponse = {
  status: string;
  initialized: boolean;
  components: Record<string, HealthComponent>;
};

export type AuthUser = {
  userId: string;
  companyId: string;
  userName: string;
  userEmail: string;
  roleId: string;
  roleName: string;
  userType: string;
  isDepartmentHead: boolean;
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

export type Department = {
  id: string;
  companyId: string;
  systemDepartmentCode?: string | null;
  departmentCode?: string | null;
  name: string;
  parentId: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
};

export type Role = {
  id: string;
  companyId: string;
  name: string;
  permissions: string[];
  status: string;
  createdAt: string;
};

export type UserIssue = {
  code: string;
  message: string;
};

export type UserView = {
  userId: string;
  companyId: string;
  userName: string;
  userEmail: string;
  departmentId: string;
  departmentName: string;
  roleId: string;
  roleName: string;
  status: string;
  userType: string;
  isDepartmentHead: boolean;
  mailAccountEmail: string;
  mailAccountStatus: string;
  permissions: string[];
  consistencyIssues: UserIssue[];
  mustChangePassword: boolean;
};

export type MailProvider = {
  id: string;
  companyId: string;
  providerType: string;
  relayHost: string;
  relayPort: number;
  username: string;
  active: boolean;
  lastTestStatus: string;
  lastTestMessage: string;
  updatedAt: string;
};

export type DirectoryOverview = {
  company: {
    id: string;
    name: string;
    domain: string;
    status: string;
    createdAt: string;
  };
  departments: Department[];
  roles: Role[];
  users: UserView[];
  mailProvider: MailProvider;
};

export type OrgImportIssue = {
  level: string;
  rowNumber: number | null;
  sheet: string | null;
  message: string;
};

export type OrgImportDepartmentPreview = {
  rowNumber: number;
  systemDepartmentCode: string;
  departmentCode: string;
  departmentName: string;
  parentDepartmentCode: string | null;
  parentDepartmentName: string | null;
  sortOrder: number;
  status: string;
};

export type OrgImportUserPreview = {
  rowNumber: number;
  loginId: string;
  name: string;
  departmentCode: string;
  departmentName: string;
  roleCode: string;
  roleName: string;
  status: string;
  action: string;
};

export type OrgImportDeactivationPreview = {
  userId: string;
  loginId: string;
  name: string;
  email: string;
  currentDepartmentName: string;
  currentRoleName: string;
  currentStatus: string;
  reason: string;
};

export type OrgImportBatch = {
  batchId: string;
  fileName: string;
  uploadedByUserId: string | null;
  uploadedByUserName: string;
  validationStatus: string;
  applyStatus: string;
  createdDepartmentCount: number;
  movedUserCount: number;
  createdUserCount: number;
  deactivatedUserCount: number;
  inactiveDepartmentCount: number;
  errors: OrgImportIssue[];
  warnings: OrgImportIssue[];
  departments: OrgImportDepartmentPreview[];
  users: OrgImportUserPreview[];
  deactivationScope: "none" | "uploaded_departments_only" | "company_all";
  usersToDeactivate: OrgImportDeactivationPreview[];
  protectedUsers: OrgImportDeactivationPreview[];
  uploadedAt: string;
  appliedAt: string | null;
};

export type DomainVerifyResponse = {
  domain: string;
  overallStatus: string;
  checks: Array<{
    recordType: string;
    host: string;
    expectedValue: string;
    status: string;
    code: string;
    message: string;
  }>;
};

export type RelayTestResponse = {
  providerConfigId: string;
  status: string;
  message: string;
  testedAt: string;
};

export type MonitoringOverview = {
  mailFailureRate24h: number;
  approvalBacklogCount: number;
  relayFailureCount1h: number;
  diskUsagePercent: number;
  alertOpenCount: number;
};

export type MonitoringEvent = {
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
  occurredAt: string;
  createdAt: string;
  payload?: Record<string, unknown>;
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
  detectedSourceLocale?: string | null;
  model: string;
  estimatedCost?: number | null;
  reviewId?: string | null;
};

export type TranslationResponse = {
  requestId: string;
  provider: string;
  providerAvailable: boolean;
  fallbackUsed: boolean;
  items: TranslationItem[];
  executedAt: string;
};

export type TranslationStatus = {
  provider: string;
  available: boolean;
  enabled: boolean;
  supportedSourceLocales: string[];
  supportedTargetLocales: string[];
  cacheEnabled: boolean;
  fallbackMessage?: string | null;
};

export type TranslationPolicy = {
  provider: string;
  enabled: boolean;
  cacheEnabled: boolean;
  supportedSourceLocales: string[];
  supportedTargetLocales: string[];
  model: string;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string | null;
  timeoutSeconds: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  circuitFailureThreshold: number;
  circuitRecoverySeconds: number;
  inputCostPerMillionTokens?: number | null;
  outputCostPerMillionTokens?: number | null;
  costPerMillionUnits?: number | null;
  costUnit: "tokens" | "characters";
  providerOptions: TranslationProviderOption[];
};

export type MonitoringAlert = {
  alertId: string;
  ruleId: string;
  metric: string;
  category: "approval" | "mail" | "messenger" | "schedule" | "file" | "notice" | "system";
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  currentValue: number;
  threshold: number;
  detectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  message: string;
};

export type OperationalBackupOverview = {
  policy: {
    enabled: boolean;
    intervalHours: number;
    retentionDays: number;
    encryptionRequired: boolean;
    storageMode: "managed_local";
    lastScheduledAt: string | null;
    nextScheduledAt: string | null;
    updatedAt: string | null;
  };
  backups: Array<{
    backupId: string;
    triggerType: "manual" | "schedule";
    status: "queued" | "running" | "completed" | "failed" | "expired";
    artifactSha256: string | null;
    sizeBytes: number | null;
    snapshotAt: string | null;
    completedAt: string | null;
    expiresAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  restoreDrills: Array<{
    drillId: string;
    backupId: string;
    status: "queued" | "running" | "completed" | "failed";
    checksumVerified: boolean;
    rpoSeconds: number | null;
    rtoSeconds: number | null;
    completedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
};

export type TranslationProviderOption = {
  provider: string;
  label: string;
  apiBaseUrl: string;
  apiKeyRequired: boolean;
};

export type TranslationConnectionTestResponse = {
  success: boolean;
  provider: string;
  model: string;
  code: string;
  message: string;
  testedAt: string;
};

export type TranslationModelListResponse = {
  success: boolean;
  provider: string;
  models: string[];
  code: string;
  message: string;
  loadedAt: string;
};

export type TranslationReview = {
  id: string;
  companyId: string;
  sourceLocale: string;
  targetLocale: string;
  sourceText: string;
  translatedText: string;
  provider: string;
  model: string;
  status: string;
  estimatedCost?: number | null;
  createdByUserId: string;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TranslationReviewList = { items: TranslationReview[]; total: number };

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

export type MailOperationsProvider = {
  providerId: string;
  providerKey: "self_hosted" | "oci_email_delivery";
  active: boolean;
  deliveryEnabled: boolean;
  relayHost: string;
  relayPort: number;
  tlsMode: "none" | "starttls" | "tls";
  senderAddress: string | null;
  usernameConfigured: boolean;
  passwordConfigured: boolean;
  dkimDomain: string | null;
  dkimSelector: string | null;
  dkimPrivateKeyConfigured: boolean;
  lastTestStatus: string;
  lastConnectionAt: string | null;
  lastConnectionError: string | null;
};
export type SelfHostedDkimGenerationResponse = {
  provider: MailOperationsProvider;
  dnsHost: string;
  dnsValue: string;
};


export type MailOperationsOverview = {
  domain: null | {
    registeredDomain: string;
    mailDomain: string;
    userHost: string;
    adminHost: string;
    mailHost: string;
    inboundMxHost: string;
    adminAccessMode: "public" | "restricted" | "private";
    adminAllowedCidrs: string[];
    activeOutboundProvider: "self_hosted" | "oci_email_delivery";
    previousOutboundProvider: "self_hosted" | "oci_email_delivery" | null;
    providerSwitchedAt: string | null;
  };
  providers: MailOperationsProvider[];
  queue: Record<string, number>;
  feedbackCount: number;
  ociSuppression: { activeCount: number; lastSeenAt: string | null };
};

export type MailDeliveryQueueItem = {
  queueId: string;
  mailId: string;
  sender: string;
  recipient: string;
  subject: string;
  provider: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailDeliveryAttemptItem = {
  attemptId: string;
  queueId: string;
  status: string;
  errorMessage: string | null;
  responseDetail: string | null;
  attemptedAt: string;
};

export type MailDeliveryEventItem = {
  eventId: string;
  queueId: string;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MailDeliveryQueueResponse = {
  provider: MailDeliveryProviderStatus;
  summary: MailDeliveryQueueSummary;
  queue: MailDeliveryQueueItem[];
  attempts: MailDeliveryAttemptItem[];
  events: MailDeliveryEventItem[];
};

export type AdminMessengerRoom = {
  roomId: string;
  roomType: string;
  roomName: string;
  status: "active" | "deleted";
  ownerUserId: string;
  ownerUserName: string;
  participantCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  retentionExpiresAt: string | null;
};

export type AdminMessengerRoomListResponse = {
  rooms: AdminMessengerRoom[];
  total: number;
};

export type MailSendResponse = {
  mailId: string;
  status: string;
  sentAt: string | null;
  deliverySummary?: {
    provider: string;
    engineEnabled: boolean;
    internalRecipientCount: number;
    externalRecipientCount: number;
    queuedCount: number;
    sentCount: number;
    failedCount: number;
    retryPendingCount: number;
  } | null;
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

export type MonitoringEventListResponse = {
  events: MonitoringEvent[];
  total: number;
};

export type ApprovalAuditLog = {
  id: string;
  event: string;
  actorUserId: string | null;
  actorUserName: string;
  targetType: string;
  targetId: string;
  statusBefore?: string;
  statusAfter?: string;
  reason?: string;
  createdAt: string;
};

export type ApprovalAuditLogListResponse = {
  logs: ApprovalAuditLog[];
};

export type ContentMessage = {
  id: string;
  key: string;
  default_locale: string;
  category: string;
  status: string;
  is_system: boolean;
  translations: Array<{ locale: string; content: string }>;
  updated_at: string;
  canDelete: boolean;
  canChangeStatus: boolean;
};

export type HelpPolicyDocument = {
  id: string;
  code: string;
  title: string;
  category: string;
  audience: string;
  content: string;
  status: string;
  version: number;
  published_at: string | null;
  is_system: boolean;
  updated_at: string;
  canDelete: boolean;
  canChangeStatus: boolean;
};

export type ContentListResponse<T> = {
  items: T[];
  total: number;
};

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

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage가 차단된 환경에서는 메모리 상태만 사용합니다.
  }
}

function safeStorageRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // localStorage가 차단된 환경에서는 메모리 상태만 사용합니다.
  }
}

export const apiBase = normalizeBrowserApiBase(
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? safeStorageGet("moaworks.apiBase"),
);

const tokenStorageKey = "moaworks.adminToken";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const detailMessage = typeof detail === "string" ? detail : detail?.userMessage ?? detail?.adminMessage;
    throw new Error(data.adminMessage ?? data.userMessage ?? detailMessage ?? "요청 처리에 실패했습니다.");
  }
  return data as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function validateSetup(payload: unknown) {
  return request<{ is_valid: boolean; errors: string[]; warnings: string[] }>("/setup/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function initializeSetup(payload: unknown) {
  return request<{ initialized: boolean; message: string }>("/setup/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStoredToken() {
  return safeStorageGet(tokenStorageKey) ?? "";
}

export function storeToken(token: string) {
  safeStorageSet(tokenStorageKey, token);
}

export function clearToken() {
  safeStorageRemove(tokenStorageKey);
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function login(payload: { email: string; password: string }) {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchDirectory(token: string) {
  return request<DirectoryOverview>("/admin/directory", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createDepartment(token: string, payload: { name: string; parentId?: string | null; sortOrder?: number }) {
  return request<Department>("/admin/departments", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function updateDepartment(
  token: string,
  departmentId: string,
  payload: { name?: string; parentId?: string | null; sortOrder?: number; status?: string },
) {
  return request<Department>(`/admin/departments/${departmentId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function deleteDepartment(token: string, departmentId: string) {
  return request<Department>(`/admin/departments/${departmentId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function createRole(token: string, payload: { name: string; permissions: string[] }) {
  return request<Role>("/admin/roles", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function updateRole(
  token: string,
  roleId: string,
  payload: { name?: string; permissions?: string[]; status?: string },
) {
  return request<Role>(`/admin/roles/${roleId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function deleteRole(token: string, roleId: string) {
  return request<Role>(`/admin/roles/${roleId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function createUser(
  token: string,
  payload: { name: string; loginId: string; password: string; departmentId: string; roleId: string; status: string; userType?: string; isDepartmentHead?: boolean },
) {
  return request<UserView>("/admin/users", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  token: string,
  userId: string,
  payload: { name?: string; password?: string; departmentId?: string; roleId?: string; status?: string; isDepartmentHead?: boolean },
) {
  return request<UserView>(`/admin/users/${userId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(token: string, userId: string) {
  return request<UserView>(`/admin/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function resetUserPassword(token: string, userId: string, revokeSessions = true) {
  return request<{ userId: string; temporaryPassword: string; mustChangePassword: boolean; sessionsRevoked: boolean }>(`/admin/users/${userId}/password-reset`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ revokeSessions }),
  });
}

export async function verifyDomain(token: string, domain: string) {
  return request<DomainVerifyResponse>("/admin/domains/verify", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ domain }),
  });
}

export async function testRelay(token: string, payload: { providerConfigId?: string; testRecipient: string }) {
  return request<RelayTestResponse>("/admin/relay/test", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}


export async function fetchMailDeliveryStatus(token: string): Promise<MailDeliveryStatusResponse> {
  return request<MailDeliveryStatusResponse>("/mail/delivery/status", {
    headers: authHeaders(token),
  });
}

export async function fetchMailDeliveryQueue(token: string): Promise<MailDeliveryQueueResponse> {
  return request<MailDeliveryQueueResponse>("/mail/delivery/queue", {
    headers: authHeaders(token),
  });
}

export async function fetchMailOperations(token: string): Promise<MailOperationsOverview> {
  return request<MailOperationsOverview>("/admin/mail-operations", { headers: authHeaders(token) });
}

export async function updateMailOperationsDomain(token: string, payload: {
  registeredDomain: string;
  mailDomain: string;
  inboundMxHost: string;
  adminAccessMode: "public" | "restricted" | "private";
  adminAllowedCidrs: string[];
}): Promise<MailOperationsOverview> {
  return request<MailOperationsOverview>("/admin/mail-operations/domain", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(payload),
  });
}

export async function updateMailOperationsProvider(token: string, providerKey: "self_hosted" | "oci_email_delivery", payload: Record<string, unknown>) {
  return request<MailOperationsProvider>(`/admin/mail-operations/providers/${providerKey}`, {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(payload),
  });
}
export async function generateSelfHostedDkim(token: string): Promise<SelfHostedDkimGenerationResponse> {
  return request<SelfHostedDkimGenerationResponse>("/admin/mail-operations/providers/self_hosted/dkim/generate", {
    method: "POST",
    headers: authHeaders(token),
  });
}


export async function switchMailOperationsProvider(token: string, targetProvider: "self_hosted" | "oci_email_delivery") {
  return request<{ previousProvider: string; activeProvider: string; pinnedQueueCount: number }>("/admin/mail-operations/providers/switch", {
    method: "POST", headers: authHeaders(token), body: JSON.stringify({ targetProvider }),
  });
}

export async function testMailOperationsProvider(token: string, providerKey: "self_hosted" | "oci_email_delivery", recipient: string) {
  return request<MailOperationsProvider>(`/admin/mail-operations/providers/${providerKey}/test`, {
    method: "POST", headers: authHeaders(token), body: JSON.stringify({ recipient }),
  });
}

export async function rollbackMailOperationsProvider(token: string) {
  return request<{ previousProvider: string; activeProvider: string; pinnedQueueCount: number }>("/admin/mail-operations/providers/rollback", {
    method: "POST", headers: authHeaders(token),
  });
}

export async function syncOciMailSuppressions(token: string) {
  return request<{ suppressionCount: number; approvedSenders: Array<{ email: string; status: string }>; emailDomains: Array<{ name: string; status: string }>; syncedAt: string }>("/admin/mail-operations/oci/suppressions/sync", {
    method: "POST", headers: authHeaders(token),
  });
}

export async function testMailDelivery(
  token: string,
  payload: { recipient: string; subject?: string; bodyText?: string },
): Promise<MailSendResponse> {
  return request<MailSendResponse>("/mail/delivery/test", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function retryMailDelivery(token: string, queueId: string) {
  return request<{ queueItem: MailDeliveryQueueItem; message: string }>(`/mail/delivery/${queueId}/retry`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function fetchAdminMessengerRooms(token: string, status: "active" | "deleted" | "all" = "all") {
  return request<AdminMessengerRoomListResponse>(`/admin/messenger/rooms?status=${encodeURIComponent(status)}&limit=200`, {
    headers: authHeaders(token),
  });
}

export async function deleteAdminMessengerRoom(token: string, roomId: string) {
  return request<{ roomId: string; status: string; deletedAt: string; retentionExpiresAt: string }>(`/admin/messenger/rooms/${roomId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function fetchMonitoringOverview(token: string): Promise<MonitoringOverview> {
  return request<MonitoringOverview>("/admin/monitoring/overview", {
    headers: authHeaders(token),
  });
}

export async function fetchMonitoringEvents(token: string, options?: { from?: string; to?: string; category?: "approval" | "mail" | "system"; severity?: Array<"INFO" | "WARN" | "ERROR" | "CRITICAL"> }) {
  const query = new URLSearchParams();
  if (options?.from) query.append("from", options.from);
  if (options?.to) query.append("to", options.to);
  if (options?.category) query.append("category", options.category);
  if (options?.severity?.length) options.severity.forEach((item) => query.append("severity", item));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<MonitoringEventListResponse>(`/admin/monitoring/events${suffix}`, {
    headers: authHeaders(token),
  });
}

export async function fetchApprovalAuditLogs(token: string, documentId?: string) {
  const suffix = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
  return request<ApprovalAuditLogListResponse>(`/approvals/audit-logs${suffix}`, {
    headers: authHeaders(token),
  });
}


export async function fetchContentMessages(token: string, options: { search?: string; status?: string } = {}) {
  const query = new URLSearchParams();
  if (options.search) query.set("search", options.search);
  if (options.status) query.set("status", options.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<ContentListResponse<ContentMessage>>(`/admin/content/messages${suffix}`, { headers: authHeaders(token) });
}

export async function createContentMessage(token: string, payload: { key: string; defaultLocale: string; category: string; translation: { locale: string; content: string } }) {
  return request<ContentMessage>("/admin/content/messages", { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) });
}

export async function updateContentMessage(token: string, id: string, payload: { key?: string; defaultLocale?: string; category?: string; translations?: Array<{ locale: string; content: string }> }) {
  return request<ContentMessage>(`/admin/content/messages/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(payload) });
}

export async function bulkContentMessageStatus(token: string, ids: string[], status: string) {
  return request<ContentListResponse<ContentMessage>>("/admin/content/messages/bulk-status", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ids, status }) });
}

export async function bulkDeleteContentMessages(token: string, ids: string[]) {
  return request<ContentListResponse<ContentMessage>>("/admin/content/messages/bulk-delete", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ids }) });
}

export async function fetchHelpPolicies(token: string, options: { search?: string; status?: string } = {}) {
  const query = new URLSearchParams();
  if (options.search) query.set("search", options.search);
  if (options.status) query.set("status", options.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<ContentListResponse<HelpPolicyDocument>>(`/admin/content/help-policies${suffix}`, { headers: authHeaders(token) });
}

export async function createHelpPolicy(token: string, payload: { code: string; title: string; category: string; audience: string; content: string }) {
  return request<HelpPolicyDocument>("/admin/content/help-policies", { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) });
}

export async function updateHelpPolicy(token: string, id: string, payload: Partial<{ title: string; category: string; audience: string; content: string; status: string }>) {
  return request<HelpPolicyDocument>(`/admin/content/help-policies/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(payload) });
}

export async function bulkHelpPolicyStatus(token: string, ids: string[], status: string) {
  return request<ContentListResponse<HelpPolicyDocument>>("/admin/content/help-policies/bulk-status", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ids, status }) });
}

export async function bulkDeleteHelpPolicies(token: string, ids: string[]) {
  return request<ContentListResponse<HelpPolicyDocument>>("/admin/content/help-policies/bulk-delete", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ids }) });
}

export async function fetchTranslationStatus(token?: string): Promise<TranslationStatus> {
  return request<TranslationStatus>(token ? "/translation/admin/status" : "/translation/status", token ? { headers: authHeaders(token) } : undefined);
}

export async function fetchMonitoringAlerts(token: string) {
  return request<{ alerts: MonitoringAlert[]; total: number }>("/admin/monitoring/alerts", { headers: authHeaders(token) });
}

export async function acknowledgeMonitoringAlert(token: string, alertId: string) {
  return request<MonitoringAlert>(`/admin/monitoring/alerts/${encodeURIComponent(alertId)}/ack`, { method: "POST", headers: authHeaders(token) });
}

export async function resolveMonitoringAlert(token: string, alertId: string) {
  return request<MonitoringAlert>(`/admin/monitoring/alerts/${encodeURIComponent(alertId)}/resolve`, { method: "POST", headers: authHeaders(token) });
}

export async function fetchOperationalBackups(token: string) {
  return request<OperationalBackupOverview>("/admin/operations/backups", { headers: authHeaders(token) });
}

export async function updateOperationalBackupPolicy(token: string, payload: { enabled: boolean; intervalHours: number; retentionDays: number }) {
  return request<OperationalBackupOverview["policy"]>("/admin/operations/backups/policy", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(payload),
  });
}

export async function queueOperationalBackup(token: string) {
  return request<OperationalBackupOverview["backups"][number]>("/admin/operations/backups/jobs", {
    method: "POST", headers: authHeaders(token),
  });
}

export async function queueOperationalRestoreDrill(token: string, backupId: string) {
  return request<OperationalBackupOverview["restoreDrills"][number]>(`/admin/operations/backups/jobs/${encodeURIComponent(backupId)}/restore-drills`, {
    method: "POST", headers: authHeaders(token),
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

export async function fetchTranslationPolicy(token: string): Promise<TranslationPolicy> {
  return request<TranslationPolicy>("/translation/admin", {
    headers: authHeaders(token),
  });
}

export async function updateTranslationPolicy(
  token: string,
  payload: Partial<{ enabled: boolean; provider: string; cacheEnabled: boolean; model: string; apiBaseUrl: string; apiKey: string; timeoutSeconds: number; maxRetries: number; rateLimitPerMinute: number; circuitFailureThreshold: number; circuitRecoverySeconds: number; inputCostPerMillionTokens: number | null; outputCostPerMillionTokens: number | null; costPerMillionUnits: number | null; costUnit: "tokens" | "characters" }>,
): Promise<TranslationPolicy> {
  return request<TranslationPolicy>("/translation/admin", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function testTranslationProviderConnection(
  token: string,
  payload: { provider: string; model: string; apiBaseUrl: string; apiKey?: string; timeoutSeconds: number },
): Promise<TranslationConnectionTestResponse> {
  return request<TranslationConnectionTestResponse>("/translation/admin/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function fetchTranslationProviderModels(
  token: string,
  payload: { provider: string; apiBaseUrl: string; apiKey?: string; timeoutSeconds: number },
): Promise<TranslationModelListResponse> {
  return request<TranslationModelListResponse>("/translation/admin/models", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function fetchTranslationReviews(token: string, reviewStatus?: string): Promise<TranslationReviewList> {
  const query = reviewStatus ? `?reviewStatus=${encodeURIComponent(reviewStatus)}` : "";
  return request<TranslationReviewList>(`/translation/reviews${query}`, { headers: authHeaders(token) });
}

export async function applyTranslationReviewAction(token: string, reviewId: string, payload: { action: "edit" | "approve" | "retranslate"; translatedText?: string }): Promise<TranslationReview> {
  return request<TranslationReview>(`/translation/reviews/${reviewId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function downloadOrgImportTemplate(token: string): Promise<Blob> {
  const response = await fetch(`${apiBase}/admin/org-import/template`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.adminMessage ?? data.userMessage ?? data.detail ?? "템플릿 다운로드에 실패했습니다.");
  }
  return response.blob();
}

export async function validateOrgImport(
  token: string,
  file: File,
  deactivationScope: "none" | "uploaded_departments_only" | "company_all",
): Promise<OrgImportBatch> {
  const body = new FormData();
  body.append("file", file);
  body.append("deactivation_scope", deactivationScope);
  const response = await fetch(`${apiBase}/admin/org-import/validate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.adminMessage ?? data.userMessage ?? data.detail ?? "업로드 검증에 실패했습니다.");
  }
  return data as OrgImportBatch;
}

export async function applyOrgImport(
  token: string,
  payload: { batchId: string; confirmDeactivateMissingUsers?: boolean; confirmationText?: string },
): Promise<OrgImportBatch> {
  return request<OrgImportBatch>("/admin/org-import/apply", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export async function fetchOrgImportBatch(token: string, batchId: string): Promise<OrgImportBatch> {
  return request<OrgImportBatch>(`/admin/org-import/${batchId}`, {
    headers: authHeaders(token),
  });
}

export async function fetchUiContract(token: string): Promise<UiContract> {
  return request<UiContract>("/ui-contract/admin", {
    headers: authHeaders(token),
  });
}

export async function fetchPublicUiContract(): Promise<UiContract> {
  return request<UiContract>("/ui-contract");
}

export async function updateUiContract(token: string, payload: UiContract): Promise<UiContract> {
  return request<UiContract>("/ui-contract/admin", {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}
