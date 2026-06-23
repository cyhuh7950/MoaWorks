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
  status: string;
  permissions: string[];
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
  mailAccountEmail: string;
  mailAccountStatus: string;
  permissions: string[];
  consistencyIssues: UserIssue[];
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

export type DomainVerifyResponse = {
  domain: string;
  overallStatus: string;
  checks: Array<{
    recordType: string;
    host: string;
    expectedValue: string;
    status: string;
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
};

export type UiContract = {
  brand: {
    primary: string;
    secondary: string;
    accent: string;
    blocked: string;
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

const fallbackApiBase = `${window.location.protocol}//${window.location.hostname}:8510/api/v1`;
export const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  window.localStorage.getItem("moaworks.apiBase") ??
  fallbackApiBase;

const tokenStorageKey = "moaworks.adminToken";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.userMessage ?? data.adminMessage ?? data.detail ?? "요청 처리에 실패했습니다.");
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
  return window.localStorage.getItem(tokenStorageKey) ?? "";
}

export function storeToken(token: string) {
  window.localStorage.setItem(tokenStorageKey, token);
}

export function clearToken() {
  window.localStorage.removeItem(tokenStorageKey);
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

export async function createUser(
  token: string,
  payload: { name: string; email: string; password: string; departmentId: string; roleId: string; status: string; userType: string },
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
  payload: { name?: string; password?: string; departmentId?: string; roleId?: string; status?: string },
) {
  return request<UserView>(`/admin/users/${userId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
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

export async function fetchTranslationStatus(): Promise<TranslationStatus> {
  return request<TranslationStatus>("/translation/status");
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
  payload: Partial<{ enabled: boolean; provider: string; cacheEnabled: boolean }>,
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

export async function fetchUiContract(token: string): Promise<UiContract> {
  return request<UiContract>("/ui-contract/admin", {
    headers: authHeaders(token),
  });
}

export async function updateUiContract(token: string, payload: UiContract): Promise<UiContract> {
  return request<UiContract>("/ui-contract/admin", {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}
