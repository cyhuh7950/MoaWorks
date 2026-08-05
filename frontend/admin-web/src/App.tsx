import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import {
  apiBase,
  applyOrgImport,
  bulkContentMessageStatus,
  bulkDeleteContentMessages,
  bulkDeleteHelpPolicies,
  bulkHelpPolicyStatus,
  createContentMessage,
  createHelpPolicy,
  fetchContentMessages,
  fetchHelpPolicies,
  updateContentMessage,
  updateHelpPolicy,
  type ContentMessage,
  type HelpPolicyDocument,
  clearToken,
  createDepartment,
  createRole,
  createUser,
  deleteDepartment,
  deleteAdminMessengerRoom,
  deleteRole,
  deleteUser,
  downloadOrgImportTemplate,
  fetchDirectory,
  fetchHealth,
  fetchMailDeliveryQueue,
  fetchAdminMessengerRooms,
  fetchMailDeliveryStatus,
  fetchMailOperations,
  fetchMonitoringEvents,
  fetchMonitoringOverview,
  fetchApprovalAuditLogs,
  fetchOrgImportBatch,
  fetchPublicUiContract,
  fetchUiContract,
  getStoredToken,
  initializeSetup,
  login,
  retryMailDelivery,
  rollbackMailOperationsProvider,
  storeToken,
  testMailOperationsProvider,
  testTranslationProviderConnection,
  testRelay,
  syncOciMailSuppressions,
  switchMailOperationsProvider,
  fetchTranslationPolicy,
  fetchTranslationProviderModels,
  fetchTranslationReviews,
  fetchTranslationStatus,
  applyTranslationReviewAction,
  requestTranslation,
  type TranslationItem,
  type TranslationRequest,
  type TranslationPolicy,
  type TranslationResponse,
  type TranslationStatus,
  type TranslationReview,
  type TranslationConnectionTestResponse,
  type TranslationModelListResponse,
  type UiContract as ServerUiContract,
  type DirectoryOverview,
  type MailDeliveryQueueResponse,
  type AdminMessengerRoom,
  type MailDeliveryStatusResponse,
  type MailOperationsOverview,
  type MailSendResponse,
  type Role,
  type DomainVerifyResponse,
  type HealthResponse,
  type MonitoringEvent,
  type MonitoringOverview,
  type ApprovalAuditLog,
  type OrgImportBatch,
  type RelayTestResponse,
  updateDepartment,
  updateMailOperationsDomain,
  updateMailOperationsProvider,
  updateRole,
  updateUiContract,
  updateTranslationPolicy,
  updateUser,
  validateOrgImport,
  validateSetup,
  verifyDomain,
} from "./api";
import { resolveLocale, supportedLocales, supportedTimezones, t, type AppLocale } from "./i18n";

type SetupForm = {
  companyName: string;
  domain: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  relayType: string;
  relayHost: string;
  relayPort: string;
  relayUsername: string;
  relayPassword: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  storagePath: string;
};

const initialForm: SetupForm = {
  companyName: "",
  domain: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
  relayType: "smtp",
  relayHost: "mail-layer",
  relayPort: "587",
  relayUsername: "",
  relayPassword: "",
  dbHost: "postgres",
  dbPort: "5432",
  dbName: "moaworks",
  dbUser: "moaworks",
  dbPassword: "change-me",
  storagePath: "./data/storage",
};

type LoginForm = {
  loginId: string;
  password: string;
};

type MailDomainOperationsForm = {
  registeredDomain: string;
  mailDomain: string;
  adminAccessMode: "public" | "restricted" | "private";
  adminAllowedCidrs: string;
};

type MailProviderOperationsForm = {
  providerKey: "self_hosted" | "oci_email_delivery";
  relayHost: string;
  relayPort: string;
  tlsMode: "none" | "starttls" | "tls";
  senderAddress: string;
  username: string;
  password: string;
  dkimDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string;
};

type PublicUiContractState = "pending" | "ready" | "error";

type UserForm = {
  userId: string;
  name: string;
  loginId: string;
  password: string;
  departmentId: string;
  roleId: string;
  status: string;
  userType: string;
};

type ManagementDialog = "user" | "department" | "role" | "orgImport" | null;
type BulkTarget = "users" | "departments" | "roles";
type BulkAction = "active" | "inactive" | "delete";
type ContentResource = "message" | "help";
type ContentBulkAction = "active" | "inactive" | "published" | "delete";
type ContentDialog =
  | { resource: "message"; mode: "create" | "detail"; item?: ContentMessage }
  | { resource: "help"; mode: "create" | "detail"; item?: HelpPolicyDocument };
type ContentBulkDialog = { resource: ContentResource; action: ContentBulkAction; ids: string[] };
type ContentMessageDraft = { key: string; defaultLocale: string; category: string; locale: string; content: string };
type HelpPolicyDraft = { code: string; title: string; category: string; audience: string; content: string };

const initialContentMessageDraft: ContentMessageDraft = { key: "", defaultLocale: "ko-KR", category: "general", locale: "ko-KR", content: "" };
const initialHelpPolicyDraft: HelpPolicyDraft = { code: "", title: "", category: "general", audience: "all", content: "" };


const initialUserForm: UserForm = {
  userId: "",
  name: "",
  loginId: "",
  password: "",
  departmentId: "",
  roleId: "",
  status: "active",
  userType: "user",
};

const ORG_IMPORT_DEACTIVATION_CONFIRMATION_TEXT = "누락 사용자 비활성화에 동의합니다.";
const ORG_IMPORT_COMPANY_ALL_CONFIRMATION_TEXT = "회사 전체 누락 사용자 비활성화에 동의합니다.";

type UiContract = {
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
};

type AdminMenuKey = "dashboard" | "users" | "departments" | "roles" | "service" | "mail" | "messenger" | "storage" | "approval" | "brand" | "language" | "help";

const adminMenus: Array<{ key: AdminMenuKey; label: string; description: string }> = [
  { key: "dashboard", label: "대시보드", description: "상태와 빠른 작업" },
  { key: "users", label: "사용자 관리", description: "사용자 생성/수정/파일 업로드" },
  { key: "departments", label: "부서 관리", description: "조직 단위 관리" },
  { key: "roles", label: "권한 관리", description: "역할과 권한 상태" },
  { key: "service", label: "서비스 운영", description: "운영 점검과 연결 확인" },
  { key: "mail", label: "메일 설정", description: "메일 연결 상태와 테스트" },
  { key: "messenger", label: "메신저 관리", description: "대화방 상태와 보존 관리" },
  { key: "storage", label: "저장소/DB 상태", description: "저장소와 DB 점검" },
  { key: "approval", label: "결재/감사", description: "감사 로그와 이벤트" },
  { key: "brand", label: "브랜드/화면 설정", description: "설정 계약과 반영" },
  { key: "language", label: "다국어/메시지", description: "번역과 상태 문구" },
  { key: "help", label: "도움말/정책", description: "정책 경로와 운영 가이드" },
];

const defaultUiContract: UiContract = {
  brand: {
    primary: "#0f766e",
    secondary: "#111827",
    accent: "#9a6b2f",
    blocked: "#9f1239",
  },
  company: {
    name: "MoaWorks",
    domain: "moaworks.local",
    logoDataUrl: "",
  },
  menuOrder: ["메일", "결재", "메신저", "일정", "주소록", "조직도", "파일", "설정"],
  homeCardOrder: ["alerts", "approval", "chat", "mail"],
  quickComposeVisible: true,
  helpText: "Help / 정책 안내 / 설정 > 보관 정책",
  messages: {
    error: "요청 처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
    warning: "설정값 검토가 필요합니다.",
    blocked: "권한이 없거나 세션이 만료되었습니다.",
    empty: "표시할 데이터가 없습니다.",
    success: "설정이 저장되었습니다.",
    sessionExpired: "다시 로그인 후 업무를 계속하세요.",
    permissionDenied: "권한이 없어 현재 작업을 수행할 수 없습니다.",
  },
};

function mergeUiContract(raw: Partial<UiContract> | null | undefined, companySeed?: Partial<UiContract["company"]> | null): UiContract {
  const brand = {
    ...defaultUiContract.brand,
    ...(raw?.brand ?? {}),
  };
  const company = {
    ...defaultUiContract.company,
    ...(raw?.company ?? {}),
    ...(companySeed ?? {}),
  };
  const logoDataUrl = company.logoDataUrl?.trim() || buildDefaultCompanyLogo(company.name, brand.primary, brand.secondary);
  return {
    brand,
    company: {
      name: company.name?.trim() || defaultUiContract.company.name,
      domain: company.domain?.trim() || defaultUiContract.company.domain,
      logoDataUrl,
    },
    menuOrder: raw?.menuOrder?.length ? raw.menuOrder : defaultUiContract.menuOrder,
    homeCardOrder: raw?.homeCardOrder?.length ? raw.homeCardOrder : defaultUiContract.homeCardOrder,
    quickComposeVisible: raw?.quickComposeVisible ?? defaultUiContract.quickComposeVisible,
    helpText: raw?.helpText || defaultUiContract.helpText,
    messages: {
      ...defaultUiContract.messages,
      ...(raw?.messages ?? {}),
    },
  };
}

function normalizeWarnings(nextWarnings: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const normalized = new Map<string, string>();
  for (const rawItem of nextWarnings ?? []) {
    const trimmed = rawItem.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.replace(/\s+/g, " ").trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.set(key, trimmed);
    }
  }
  return Array.from(normalized.values());
}

type DepartmentItem = DirectoryOverview["departments"][number];

type DepartmentTreeRow = {
  item: DepartmentItem;
  level: number;
  path: string;
  parentName: string;
};

function normalizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return fallback;
}

function buildCompanyInitials(name: string): string {
  const cleaned = name.replace(/[^0-9A-Za-z가-힣]/g, "").trim();
  if (!cleaned) {
    return "MW";
  }
  const glyphs = Array.from(cleaned);
  return glyphs.slice(0, 2).join("").toUpperCase();
}

function buildDefaultCompanyLogo(name: string, primary: string, secondary: string): string {
  const initials = buildCompanyInitials(name);
  const safePrimary = normalizeHexColor(primary, defaultUiContract.brand.primary);
  const safeSecondary = normalizeHexColor(secondary, defaultUiContract.brand.secondary);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192" role="img" aria-label="${name} logo">
      <defs>
        <linearGradient id="mwLogoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${safePrimary}" />
          <stop offset="100%" stop-color="${safeSecondary}" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="44" fill="url(#mwLogoBg)" />
      <circle cx="148" cy="48" r="20" fill="rgba(255,255,255,0.14)" />
      <text x="96" y="108" text-anchor="middle" font-family="Segoe UI, Noto Sans KR, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${initials}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildDepartmentHierarchy(departments: DepartmentItem[]): { rows: DepartmentTreeRow[]; pathMap: Map<string, string> } {
  const byParent = new Map<string, DepartmentItem[]>();
  const pathMap = new Map<string, string>();
  const roots: DepartmentItem[] = [];

  const sorted = [...departments].sort((left, right) => {
    const sortGap = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
    if (sortGap !== 0) {
      return sortGap;
    }
    return left.name.localeCompare(right.name, "ko-KR");
  });

  for (const item of sorted) {
    if (item.parentId && departments.some((candidate) => candidate.id === item.parentId)) {
      const bucket = byParent.get(item.parentId) ?? [];
      bucket.push(item);
      byParent.set(item.parentId, bucket);
    } else {
      roots.push(item);
    }
  }

  const rows: DepartmentTreeRow[] = [];
  const visited = new Set<string>();

  const visit = (item: DepartmentItem, level: number, parentPath: string, parentName: string) => {
    if (visited.has(item.id)) {
      return;
    }
    visited.add(item.id);
    const path = parentPath ? `${parentPath} > ${item.name}` : item.name;
    pathMap.set(item.id, path);
    rows.push({ item, level, path, parentName });
    for (const child of byParent.get(item.id) ?? []) {
      visit(child, level + 1, path, item.name);
    }
  };

  for (const root of roots) {
    visit(root, 0, "", "최상위");
  }

  for (const item of sorted) {
    if (!visited.has(item.id)) {
      visit(item, 0, "", "최상위");
    }
  }

  return { rows, pathMap };
}

const adminCopy: Record<AppLocale, Record<string, string>> = {
  "ko-KR": {
    adminEmail: "관리자 아이디",
    adminPassword: "비밀번호",
    overviewTitle: "운영 개요",
    approvalAuditTitle: "결재 감사 로그",
    refreshOps: "운영 데이터 새로고침",
    refreshMonitoring: "감시 데이터 새로고침",
    refreshApprovalLogs: "결재 로그 새로고침",
    newUser: "새 사용자 입력",
    editUser: "사용자 수정",
    createUser: "사용자 생성",
    addDepartment: "부서 추가",
    addRole: "권한 역할 추가",
    roleStatus: "권한 역할 현황",
    verifyDomain: "도메인 검증",
    relayTest: "Relay 테스트",
    authContract: "공통 인증 계약 요약",
    createDepartment: "부서 생성",
    createRole: "권한 생성",
    verifyDomainAction: "도메인 검증 실행",
    relayTestAction: "Relay 테스트 실행",
    edit: "수정",
    deactivate: "비활성화",
    activate: "활성화",
  },
  "en-US": {
    adminEmail: "Admin ID",
    adminPassword: "Password",
    overviewTitle: "Operations Overview",
    approvalAuditTitle: "Approval Audit Logs",
    refreshOps: "Refresh operations",
    refreshMonitoring: "Refresh monitoring",
    refreshApprovalLogs: "Refresh audit logs",
    newUser: "New user form",
    editUser: "Update user",
    createUser: "Create user",
    addDepartment: "Add department",
    addRole: "Add role",
    roleStatus: "Role Status",
    verifyDomain: "Domain Verification",
    relayTest: "Relay Test",
    authContract: "Shared Auth Contract",
    createDepartment: "Create department",
    createRole: "Create role",
    verifyDomainAction: "Run domain verification",
    relayTestAction: "Run relay test",
    edit: "Edit",
    deactivate: "Deactivate",
    activate: "Activate",
  },
  "ja-JP": {
    adminEmail: "管理者ID",
    adminPassword: "パスワード",
    overviewTitle: "運用概要",
    approvalAuditTitle: "承認監査ログ",
    refreshOps: "運用データ更新",
    refreshMonitoring: "監視データ更新",
    refreshApprovalLogs: "監査ログ更新",
    newUser: "新規ユーザー入力",
    editUser: "ユーザー更新",
    createUser: "ユーザー作成",
    addDepartment: "部門追加",
    addRole: "権限ロール追加",
    roleStatus: "ロール状況",
    verifyDomain: "ドメイン検証",
    relayTest: "Relay テスト",
    authContract: "共通認証契約",
    createDepartment: "部門作成",
    createRole: "ロール作成",
    verifyDomainAction: "ドメイン検証実行",
    relayTestAction: "Relay テスト実行",
    edit: "編集",
    deactivate: "無効化",
    activate: "有効化",
  },
  "zh-CN": {
    adminEmail: "管理员ID",
    adminPassword: "密码",
    overviewTitle: "运维概览",
    approvalAuditTitle: "审批审计日志",
    refreshOps: "刷新运维数据",
    refreshMonitoring: "刷新监控数据",
    refreshApprovalLogs: "刷新审计日志",
    newUser: "新建用户表单",
    editUser: "更新用户",
    createUser: "创建用户",
    addDepartment: "新增部门",
    addRole: "新增角色",
    roleStatus: "角色状态",
    verifyDomain: "域名校验",
    relayTest: "Relay 测试",
    authContract: "统一认证契约",
    createDepartment: "创建部门",
    createRole: "创建角色",
    verifyDomainAction: "执行域名校验",
    relayTestAction: "执行 Relay 测试",
    edit: "编辑",
    deactivate: "停用",
    activate: "启用",
  },
  "es-ES": {
    adminEmail: "ID admin",
    adminPassword: "Contraseña",
    overviewTitle: "Resumen operativo",
    approvalAuditTitle: "Auditoría de aprobaciones",
    refreshOps: "Actualizar operaciones",
    refreshMonitoring: "Actualizar monitoreo",
    refreshApprovalLogs: "Actualizar auditoría",
    newUser: "Nuevo usuario",
    editUser: "Actualizar usuario",
    createUser: "Crear usuario",
    addDepartment: "Agregar departamento",
    addRole: "Agregar rol",
    roleStatus: "Estado de roles",
    verifyDomain: "Validación de dominio",
    relayTest: "Prueba de relay",
    authContract: "Contrato de autenticación",
    createDepartment: "Crear departamento",
    createRole: "Crear rol",
    verifyDomainAction: "Ejecutar validación",
    relayTestAction: "Ejecutar prueba relay",
    edit: "Editar",
    deactivate: "Desactivar",
    activate: "Activar",
  },
  "fr-FR": {
    adminEmail: "Identifiant admin",
    adminPassword: "Mot de passe",
    overviewTitle: "Vue d'exploitation",
    approvalAuditTitle: "Journaux d'audit",
    refreshOps: "Actualiser l'exploitation",
    refreshMonitoring: "Actualiser la supervision",
    refreshApprovalLogs: "Actualiser l'audit",
    newUser: "Nouvel utilisateur",
    editUser: "Mettre à jour",
    createUser: "Créer l'utilisateur",
    addDepartment: "Ajouter un département",
    addRole: "Ajouter un rôle",
    roleStatus: "État des rôles",
    verifyDomain: "Vérification du domaine",
    relayTest: "Test Relay",
    authContract: "Contrat d'authentification",
    createDepartment: "Créer le département",
    createRole: "Créer le rôle",
    verifyDomainAction: "Lancer la vérification",
    relayTestAction: "Lancer le test Relay",
    edit: "Modifier",
    deactivate: "Désactiver",
    activate: "Activer",
  },
  "de-DE": {
    adminEmail: "Admin-ID",
    adminPassword: "Passwort",
    overviewTitle: "Betriebsübersicht",
    approvalAuditTitle: "Freigabe-Audit-Logs",
    refreshOps: "Betriebsdaten aktualisieren",
    refreshMonitoring: "Monitoring aktualisieren",
    refreshApprovalLogs: "Audit-Logs aktualisieren",
    newUser: "Neuer Benutzer",
    editUser: "Benutzer aktualisieren",
    createUser: "Benutzer erstellen",
    addDepartment: "Abteilung hinzufügen",
    addRole: "Rolle hinzufügen",
    roleStatus: "Rollenstatus",
    verifyDomain: "Domain-Prüfung",
    relayTest: "Relay-Test",
    authContract: "Gemeinsamer Auth-Vertrag",
    createDepartment: "Abteilung erstellen",
    createRole: "Rolle erstellen",
    verifyDomainAction: "Domain-Prüfung starten",
    relayTestAction: "Relay-Test starten",
    edit: "Bearbeiten",
    deactivate: "Deaktivieren",
    activate: "Aktivieren",
  },
};

type PermissionOption = {
  code: string;
  label: string;
};

type PermissionGroup = {
  key: string;
  label: string;
  options: PermissionOption[];
};

const defaultRolePermissions = ["mail:read", "approval:read", "profile:read"];

const permissionGroups: PermissionGroup[] = [
  {
    key: "mail",
    label: "메일",
    options: [
      { code: "mail:read", label: "메일 조회" },
      { code: "mail:send", label: "메일 발송/임시저장" },
    ],
  },
  {
    key: "approval",
    label: "결재",
    options: [
      { code: "approval:read", label: "결재 조회" },
      { code: "approval:create", label: "문서 작성" },
      { code: "approval:submit", label: "상신" },
      { code: "approval:act", label: "승인/반려 처리" },
      { code: "approval:withdraw", label: "회수" },
      { code: "approval:rework", label: "재기안" },
      { code: "approval:force", label: "관리자 직권 처리" },
    ],
  },
  {
    key: "messenger",
    label: "메신저",
    options: [
      { code: "messenger:read", label: "대화 조회" },
      { code: "messenger:write", label: "메시지 전송/방 생성" },
    ],
  },
  {
    key: "profile",
    label: "프로필",
    options: [{ code: "profile:read", label: "프로필 조회" }],
  },
  {
    key: "directory",
    label: "조직/사용자",
    options: [{ code: "directory:write", label: "조직/사용자 관리" }],
  },
  {
    key: "ops",
    label: "운영 점검",
    options: [
      { code: "relay:test", label: "Relay 테스트" },
      { code: "domain:verify", label: "도메인 검증" },
    ],
  },
  {
    key: "admin",
    label: "관리자",
    options: [{ code: "admin:*", label: "관리자 전체 권한" }],
  },
];

const permissionOptionMap = new Map(
  permissionGroups.flatMap((group) => group.options.map((option) => [option.code, option] as const)),
);
const knownPermissionCodeSet = new Set(permissionOptionMap.keys());

function normalizePermissionCodes(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawValue of values) {
    const trimmed = rawValue.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage가 차단된 환경에서는 현재 세션 상태만 유지합니다.
  }
}

function InlineHint({ label }: { label: string }) {
  return (
    <span className="inline-hint" tabIndex={0} role="note" title={label} aria-label={label}>
      i
    </span>
  );
}

function normalizeLoginIdInput(value: string): string {
  return value.trim().toLowerCase();
}

function buildCompanyLoginEmail(loginId: string, companyDomain: string): string {
  return `${normalizeLoginIdInput(loginId)}@${companyDomain.trim().toLowerCase()}`;
}

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(resolveLocale(safeLocalStorageGet("moaworks.locale")));
  const copy = adminCopy[locale];
  const [timezone, setTimezone] = useState(safeLocalStorageGet("moaworks.timezone") || "Asia/Seoul");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [overview, setOverview] = useState<DirectoryOverview | null>(null);
  const [monitoringOverview, setMonitoringOverview] = useState<MonitoringOverview | null>(null);
  const [monitoringEvents, setMonitoringEvents] = useState<MonitoringEvent[]>([]);
  const [approvalAuditLogs, setApprovalAuditLogs] = useState<ApprovalAuditLog[]>([]);
  const [domainResult, setDomainResult] = useState<DomainVerifyResponse | null>(null);
  const [relayResult, setRelayResult] = useState<RelayTestResponse | null>(null);
  const [mailDeliveryStatus, setMailDeliveryStatus] = useState<MailDeliveryStatusResponse | null>(null);
  const [mailDeliveryQueue, setMailDeliveryQueue] = useState<MailDeliveryQueueResponse | null>(null);
  const [mailDeliveryTestResult, setMailDeliveryTestResult] = useState<MailSendResponse | null>(null);
  const [adminMessengerRooms, setAdminMessengerRooms] = useState<AdminMessengerRoom[]>([]);
  const [adminMessengerStatus, setAdminMessengerStatus] = useState<"active" | "deleted" | "all">("all");
  const [messengerDeleteTarget, setMessengerDeleteTarget] = useState<AdminMessengerRoom | null>(null);
  const [mailOperations, setMailOperations] = useState<MailOperationsOverview | null>(null);
  const [mailDomainOperationsForm, setMailDomainOperationsForm] = useState<MailDomainOperationsForm>({ registeredDomain: "", mailDomain: "", adminAccessMode: "restricted", adminAllowedCidrs: "" });
  const [mailProviderOperationsForm, setMailProviderOperationsForm] = useState<MailProviderOperationsForm>({ providerKey: "self_hosted", relayHost: "", relayPort: "25", tlsMode: "none", senderAddress: "", username: "", password: "", dkimDomain: "", dkimSelector: "", dkimPrivateKey: "" });
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus | null>(null);
  const [translationPolicy, setTranslationPolicy] = useState<TranslationPolicy | null>(null);
  const [translationSource, setTranslationSource] = useState("");
  const [translationSourceLocale, setTranslationSourceLocale] = useState("auto");
  const [translationTargetLocale, setTranslationTargetLocale] = useState("en");
  const [translationResult, setTranslationResult] = useState<TranslationItem[]>([]);
  const [translationError, setTranslationError] = useState("");
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationConnectionResult, setTranslationConnectionResult] = useState<TranslationConnectionTestResponse | null>(null);
  const [translationModelListResult, setTranslationModelListResult] = useState<TranslationModelListResponse | null>(null);
  const [translationModels, setTranslationModels] = useState<string[]>([]);
  const [translationReviews, setTranslationReviews] = useState<TranslationReview[]>([]);
  const [translationReviewStatus, setTranslationReviewStatus] = useState("all");
  const [selectedTranslationReviewId, setSelectedTranslationReviewId] = useState("");
  const [translationReviewDraft, setTranslationReviewDraft] = useState("");
  const [translationPolicyForm, setTranslationPolicyForm] = useState({
    provider: "disabled", model: "", apiBaseUrl: "", apiKey: "", cacheEnabled: true,
    timeoutSeconds: "15", maxRetries: "2", rateLimitPerMinute: "60",
    circuitFailureThreshold: "5", circuitRecoverySeconds: "60",
    inputCostPerMillionTokens: "", outputCostPerMillionTokens: "",
    costPerMillionUnits: "", costUnit: "tokens" as "tokens" | "characters",
  });
  const [form, setForm] = useState<SetupForm>(initialForm);
  const [loginForm, setLoginForm] = useState<LoginForm>({ loginId: "", password: "" });
  const [publicUiContractState, setPublicUiContractState] = useState<PublicUiContractState>("pending");
  const [publicUiContractError, setPublicUiContractError] = useState("");
  const [userForm, setUserForm] = useState<UserForm>(initialUserForm);
  const [userSearch, setUserSearch] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("visible");
  const [orgImportFile, setOrgImportFile] = useState<File | null>(null);
  const [orgImportBatch, setOrgImportBatch] = useState<OrgImportBatch | null>(null);
  const [orgImportHistory, setOrgImportHistory] = useState<OrgImportBatch[]>([]);
  const [orgImportDialogOpen, setOrgImportDialogOpen] = useState(false);
  const [orgImportDeactivationScope, setOrgImportDeactivationScope] = useState<"none" | "uploaded_departments_only" | "company_all">("uploaded_departments_only");
  const [orgImportConfirmChecked, setOrgImportConfirmChecked] = useState(false);
  const [orgImportConfirmationText, setOrgImportConfirmationText] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [departmentParentId, setDepartmentParentId] = useState("");
  const [departmentEditingId, setDepartmentEditingId] = useState("");
  const [departmentStatusFilter, setDepartmentStatusFilter] = useState("visible");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [roleStatusFilter, setRoleStatusFilter] = useState("visible");
  const [selectedRoleLookupId, setSelectedRoleLookupId] = useState("");
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [roleEditingId, setRoleEditingId] = useState("");
  const [roleSelectedPermissions, setRoleSelectedPermissions] = useState<string[]>(defaultRolePermissions);
  const [managementDialog, setManagementDialog] = useState<ManagementDialog>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [bulkConfirmation, setBulkConfirmation] = useState<{ target: BulkTarget; action: BulkAction; ids: string[] } | null>(null);
  const [bulkActionError, setBulkActionError] = useState("");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [relayRecipient, setRelayRecipient] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(getStoredToken());
  const [activeAdminMenu, setActiveAdminMenu] = useState<AdminMenuKey>("dashboard");
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [operationsDialog, setOperationsDialog] = useState<"domain" | "relay" | "mailTest" | "provider" | "storage" | "audit" | "brand" | "language" | "help" | null>(null);
  const [operationDetail, setOperationDetail] = useState<{ title: string; lines: string[] } | null>(null);
  const [uiContractDraft, setUiContractDraft] = useState<UiContract>(() => defaultUiContract);
  const [contentMessages, setContentMessages] = useState<ContentMessage[]>([]);
  const [helpPolicies, setHelpPolicies] = useState<HelpPolicyDocument[]>([]);
  const [messageSearch, setMessageSearch] = useState("");
  const [messageStatusFilter, setMessageStatusFilter] = useState("visible");
  const [helpSearch, setHelpSearch] = useState("");
  const [helpStatusFilter, setHelpStatusFilter] = useState("visible");
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [selectedHelpIds, setSelectedHelpIds] = useState<string[]>([]);
  const [contentDialog, setContentDialog] = useState<ContentDialog | null>(null);
  const [contentBulkDialog, setContentBulkDialog] = useState<ContentBulkDialog | null>(null);
  const [contentDialogError, setContentDialogError] = useState("");
  const [contentMessageDraft, setContentMessageDraft] = useState<ContentMessageDraft>(initialContentMessageDraft);
  const [helpPolicyDraft, setHelpPolicyDraft] = useState<HelpPolicyDraft>(initialHelpPolicyDraft);
  const brandGuide = [
    { title: "대표 색상", value: "#0f766e", target: "주요 버튼, 활성 탭, 핵심 승인/저장 액션" },
    { title: "보조 색상", value: "#111827", target: "헤더, 운영 개요, 기본 제품 톤" },
    { title: "강조 색상", value: "#9a6b2f", target: "메일/메신저 보조 카드, 안내 포인트" },
    { title: "차단 색상", value: "#9f1239", target: "긴급 경고, 차단, 가장 강한 제한 상태" },
  ];
  const componentGuide = [
    { title: "카드", body: "4개 프로그램 모두 둥근 카드 + 얕은 그림자 + 상단 킥커 구조를 유지" },
    { title: "버튼", body: "주요 액션은 대표 색상, 보조 액션은 흰 배경 + 회색 경계선으로 통일" },
    { title: "배지", body: "상태 배지는 pill 형태와 굵은 텍스트로 제품군 공통 규칙을 유지" },
    { title: "탭", body: "활성은 채움, 비활성은 외곽선 기준으로 통일해 모바일/웹 모두 같은 감각을 유지" },
  ];
  const settingsContracts = [
    {
      title: "브랜드 설정값 묶음",
      values: "대표 / 보조 / 강조 / 차단 색상",
      targets: "user-web 상단 바 · mobile-app 긴급 카드 · desktop-client 로컬 패널",
    },
    {
      title: "메뉴 구성 설정 묶음",
      values: "좌측 메뉴 순서 / 홈 카드 우선순위 / 빠른 작성 노출",
      targets: "user-web 좌측 메뉴 · mobile-app 홈 카드 · desktop-client 진입 보드",
    },
    {
      title: "메시지 설정 묶음",
      values: "오류 / 경고 / 차단 / 빈 상태 / 성공 / 세션 만료",
      targets: "4개 프로그램 공통 상태 박스와 도움말 안내",
    },
    {
      title: "Help / 정책 안내 묶음",
      values: "정책 본문 직접 노출 금지 / 경로 안내 문구",
      targets: "user-web · mobile-app · desktop-client 동일 경로 문구",
    },
  ];

  function resetAdminSession(nextMessage?: string) {
    clearToken();
    setToken("");
    setOverview(null);
    setMonitoringOverview(null);
    setMonitoringEvents([]);
    setApprovalAuditLogs([]);
    setTranslationPolicy(null);
    setAlertPanelOpen(false);
    setActiveAdminMenu("dashboard");
    if (nextMessage) {
      setErrors([nextMessage]);
    }
  }

  function clearTransientFeedback() {
    setMessage("");
    setErrors([]);
    setWarnings([]);
    setTranslationError("");
  }

  function navigateAdminMenu(nextMenu: AdminMenuKey) {
    setAlertPanelOpen(false);
    clearTransientFeedback();
    setActiveAdminMenu(nextMenu);
  }

  async function refreshHealth() {
    const data = await fetchHealth();
    setHealth(data);
    return data;
  }

  async function refreshPublicUiContract() {
    try {
      const contract = await fetchPublicUiContract();
      const domain = contract.company?.domain?.trim();
      if (!domain) {
        throw new Error("public UI contract domain is empty");
      }
      setUiContractDraft(mergeUiContract(contract));
      setPublicUiContractError("");
      setPublicUiContractState("ready");
    } catch {
      setPublicUiContractError("회사 도메인을 확인하지 못했습니다. 잠시 후 새로고침한 뒤 다시 시도하세요.");
      setPublicUiContractState("error");
    }
  }

  async function refreshDirectory(nextToken = token) {
    if (!nextToken) {
      return;
    }
    const data = await fetchDirectory(nextToken);
    setOverview(data);
    setDomainInput((current) => current || data.company.domain);
    setRelayRecipient((current) => current || `relay-check@${data.company.domain}`);
    setLoginForm((current) => ({
      loginId:
        current.loginId ||
        normalizeLoginIdInput((data.users.find((item) => item.userType === "admin")?.userEmail || "").split("@")[0] || ""),
      password: current.password,
    }));
    const defaultActiveDepartmentId = data.departments.find((item) => item.status === "active")?.id || data.departments[0]?.id || "";
    setUserForm((current) => ({
      ...current,
      departmentId: current.departmentId || defaultActiveDepartmentId,
      roleId: current.roleId || data.roles.find((item) => item.name === "일반사용자")?.id || data.roles[0]?.id || "",
    }));
    setUiContractDraft((current) => mergeUiContract(current, {
      name: data.company.name,
      domain: data.company.domain,
    }));
  }

  async function refreshMonitoring(nextToken = token) {
    if (!nextToken) return;
    const nextMonitoring = await fetchMonitoringOverview(nextToken);
    setMonitoringOverview(nextMonitoring);
    const events = await fetchMonitoringEvents(nextToken);
    setMonitoringEvents(events.events ?? []);
  }

  async function refreshMailDelivery(nextToken = token) {
    if (!nextToken) return;
    const [status, queue, operations] = await Promise.all([
      fetchMailDeliveryStatus(nextToken),
      fetchMailDeliveryQueue(nextToken),
      fetchMailOperations(nextToken),
    ]);
    setMailDeliveryStatus(status);
    setMailDeliveryQueue(queue);
    setMailOperations(operations);
    if (operations.domain) {
      setMailDomainOperationsForm({
        registeredDomain: operations.domain.registeredDomain,
        mailDomain: operations.domain.mailDomain,
        adminAccessMode: operations.domain.adminAccessMode,
        adminAllowedCidrs: operations.domain.adminAllowedCidrs.join("\n"),
      });
    }
    const selected = operations.providers.find((item) => item.providerKey === mailProviderOperationsForm.providerKey)
      ?? operations.providers.find((item) => item.active);
    if (selected) {
      setMailProviderOperationsForm((current) => ({
        ...current,
        providerKey: selected.providerKey,
        relayHost: selected.relayHost,
        relayPort: String(selected.relayPort),
        tlsMode: selected.tlsMode,
        senderAddress: selected.senderAddress ?? "",
        username: "",
        password: "",
        dkimDomain: selected.dkimDomain ?? "",
        dkimSelector: selected.dkimSelector ?? "",
        dkimPrivateKey: "",
      }));
    }
  }

  async function refreshAdminMessengerRooms(nextToken = token, statusFilter = adminMessengerStatus) {
    if (!nextToken) return;
    const response = await fetchAdminMessengerRooms(nextToken, statusFilter);
    setAdminMessengerRooms(response.rooms ?? []);
  }

  async function confirmDeleteAdminMessengerRoom() {
    if (!token || !messengerDeleteTarget) return;
    setLoading(true);
    setErrors([]);
    try {
      await deleteAdminMessengerRoom(token, messengerDeleteTarget.roomId);
      setMessengerDeleteTarget(null);
      await refreshAdminMessengerRooms(token);
      setMessage("대화방을 삭제 상태로 전환했습니다. 대화와 첨부는 14일 후 자동 정리됩니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "대화방 삭제 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshApprovalAuditLogs(nextToken = token) {
    if (!nextToken) return;
    const response = await fetchApprovalAuditLogs(nextToken);
    setApprovalAuditLogs(response.logs ?? []);
  }


  async function refreshContentOperations(nextToken = token) {
    if (!nextToken) return;
    const [messages, policies] = await Promise.all([
      fetchContentMessages(nextToken, { status: "all" }),
      fetchHelpPolicies(nextToken, { status: "all" }),
    ]);
    setContentMessages(messages.items ?? []);
    setHelpPolicies(policies.items ?? []);
  }

  function openContentMessageDialog(item?: ContentMessage) {
    setContentDialogError("");
    setContentMessageDraft(item ? {
      key: item.key,
      defaultLocale: item.default_locale,
      category: item.category,
      locale: item.translations[0]?.locale ?? item.default_locale,
      content: item.translations[0]?.content ?? "",
    } : initialContentMessageDraft);
    setContentDialog({ resource: "message", mode: item ? "detail" : "create", item });
  }

  function openHelpPolicyDialog(item?: HelpPolicyDocument) {
    setContentDialogError("");
    setHelpPolicyDraft(item ? {
      code: item.code,
      title: item.title,
      category: item.category,
      audience: item.audience,
      content: item.content,
    } : initialHelpPolicyDraft);
    setContentDialog({ resource: "help", mode: item ? "detail" : "create", item });
  }

  async function saveContentMessage(event: FormEvent) {
    event.preventDefault();
    if (!token || !contentDialog || contentDialog.resource !== "message") return;
    setLoading(true);
    setContentDialogError("");
    try {
      const saved = contentDialog.mode === "create"
        ? await createContentMessage(token, { key: contentMessageDraft.key, defaultLocale: contentMessageDraft.defaultLocale, category: contentMessageDraft.category, translation: { locale: contentMessageDraft.locale, content: contentMessageDraft.content } })
        : await updateContentMessage(token, contentDialog.item!.id, {
            key: contentMessageDraft.key,
            defaultLocale: contentMessageDraft.defaultLocale,
            category: contentMessageDraft.category,
            translations: [{ locale: contentMessageDraft.locale, content: contentMessageDraft.content }],
          });
      await refreshContentOperations(token);
      setContentDialog({ resource: "message", mode: "detail", item: saved });
      setMessage(contentDialog.mode === "create" ? "메시지를 등록했습니다." : "메시지를 저장했습니다.");
    } catch (error) {
      setContentDialogError(error instanceof Error ? error.message : "메시지 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function saveHelpPolicy(event: FormEvent) {
    event.preventDefault();
    if (!token || !contentDialog || contentDialog.resource !== "help") return;
    setLoading(true);
    setContentDialogError("");
    try {
      const saved = contentDialog.mode === "create"
        ? await createHelpPolicy(token, helpPolicyDraft)
        : await updateHelpPolicy(token, contentDialog.item!.id, helpPolicyDraft);
      await refreshContentOperations(token);
      setContentDialog({ resource: "help", mode: "detail", item: saved });
      setMessage(contentDialog.mode === "create" ? "정책을 등록했습니다." : "정책을 저장했습니다.");
    } catch (error) {
      setContentDialogError(error instanceof Error ? error.message : "정책 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function toggleContentSelection(resource: ContentResource, id: string) {
    const setter = resource === "message" ? setSelectedMessageIds : setSelectedHelpIds;
    setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function executeContentBulkAction() {
    if (!token || !contentBulkDialog) return;
    setLoading(true);
    setContentDialogError("");
    try {
      const { resource, action, ids } = contentBulkDialog;
      if (resource === "message") {
        if (action === "delete") await bulkDeleteContentMessages(token, ids);
        else await bulkContentMessageStatus(token, ids, action);
        setSelectedMessageIds([]);
      } else {
        if (action === "delete") await bulkDeleteHelpPolicies(token, ids);
        else await bulkHelpPolicyStatus(token, ids, action === "active" ? "published" : action);
        setSelectedHelpIds([]);
      }
      await refreshContentOperations(token);
      setMessage(action === "delete" ? "선택 항목을 deleted 상태로 전환했습니다." : "선택 항목의 상태를 변경했습니다.");
      setContentBulkDialog(null);
    } catch (error) {
      setContentDialogError(error instanceof Error ? error.message : "일괄 작업에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function normalizeTranslationLocale(value: string) {
    return value
      .trim()
      .replace("_", "-")
      .toLowerCase()
      .split("-")[0];
  }

  async function refreshTranslationState(nextToken = token) {
    const status = await fetchTranslationStatus(nextToken || undefined);
    setTranslationStatus(status);
    if (!nextToken) {
      setTranslationPolicy(null);
      return;
    }
    try {
      const policy = await fetchTranslationPolicy(nextToken);
      setTranslationPolicy(policy);
      setTranslationPolicyForm({
        provider: policy.provider, model: policy.model, apiBaseUrl: policy.apiBaseUrl, apiKey: "",
        cacheEnabled: policy.cacheEnabled, timeoutSeconds: String(policy.timeoutSeconds),
        maxRetries: String(policy.maxRetries), rateLimitPerMinute: String(policy.rateLimitPerMinute),
        circuitFailureThreshold: String(policy.circuitFailureThreshold), circuitRecoverySeconds: String(policy.circuitRecoverySeconds),
        inputCostPerMillionTokens: policy.inputCostPerMillionTokens == null ? "" : String(policy.inputCostPerMillionTokens),
        outputCostPerMillionTokens: policy.outputCostPerMillionTokens == null ? "" : String(policy.outputCostPerMillionTokens),
        costPerMillionUnits: policy.costPerMillionUnits == null ? "" : String(policy.costPerMillionUnits), costUnit: policy.costUnit,
      });
      setTranslationConnectionResult(null);
      setTranslationModelListResult(null);
      setTranslationModels(policy.model ? [policy.model] : []);
      const reviews = await fetchTranslationReviews(nextToken, translationReviewStatus === "all" ? undefined : translationReviewStatus);
      setTranslationReviews(reviews.items);
      setTranslationTargetLocale(toTranslationLocale(policy.supportedTargetLocales.includes(translationTargetLocale) ? translationTargetLocale : policy.supportedTargetLocales[0]));
    } catch (error) {
      setTranslationPolicy(null);
      setTranslationError(error instanceof Error ? error.message : "번역 정책 조회 실패");
    }
  }

  function saveLocale(nextLocale: AppLocale) {
    setLocale(nextLocale);
    safeLocalStorageSet("moaworks.locale", nextLocale);
  }

  function saveTimezone(nextTimezone: string) {
    setTimezone(nextTimezone);
    safeLocalStorageSet("moaworks.timezone", nextTimezone);
  }

  async function handleUiContractSave() {
    if (!token) {
      setErrors(["관리자 로그인 후 설정을 저장할 수 있습니다."]);
      return;
    }
    try {
      const payload = mergeUiContract(uiContractDraft, overview ? {
        name: overview.company.name,
        domain: overview.company.domain,
      } : undefined);
      const saved = await updateUiContract(token, payload as ServerUiContract);
      setUiContractDraft(mergeUiContract(saved, overview ? {
        name: overview.company.name,
        domain: overview.company.domain,
      } : undefined));
      setMessage(saved.messages.success);
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "설정 저장 실패"]);
    }
  }

  async function reloadUiContract(nextToken = token) {
    if (!nextToken) return;
    const contract = await fetchUiContract(nextToken);
    setUiContractDraft(mergeUiContract(contract, overview ? {
      name: overview.company.name,
      domain: overview.company.domain,
    } : undefined));
  }

  async function handleCompanyLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setErrors(["로고는 이미지 파일만 업로드할 수 있습니다."]);
      return;
    }
    const logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("로고 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    }).catch((error: unknown) => {
      setErrors([error instanceof Error ? error.message : "로고 파일 처리 실패"]);
      return "";
    });
    if (!logoDataUrl) {
      return;
    }
    setUiContractDraft((current) => ({
      ...current,
      company: {
        ...current.company,
        logoDataUrl,
      },
    }));
    setMessage("로고 미리보기를 갱신했습니다. 저장 후 사용자 화면에 반영됩니다.");
    setErrors([]);
  }

  function restoreDefaultCompanyLogo() {
    setUiContractDraft((current) => ({
      ...current,
      company: {
        ...current.company,
        logoDataUrl: buildDefaultCompanyLogo(current.company.name, current.brand.primary, current.brand.secondary),
      },
    }));
    setMessage("기본 로고로 복구했습니다. 저장 후 운영 화면에 반영됩니다.");
    setErrors([]);
  }

  function toTranslationLocale(code: string): string {
    const normalized = code.trim().replace("_", "-").toLowerCase();
    if (normalized === "zh-cn") {
      return "zh-cn";
    }
    return normalized.split("-")[0];
  }

  async function toggleTranslationPolicy(nextEnabled: boolean) {
    if (!token) return;
    try {
      await updateTranslationPolicy(token, {
        enabled: nextEnabled,
      });
      await refreshTranslationState(token);
      setTranslationError("");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "번역 정책 변경 실패");
    }
  }

  async function saveTranslationProviderPolicy(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setTranslationLoading(true);
    setTranslationError("");
    try {
      const payload = {
        enabled: translationStatus?.enabled ?? false,
        provider: translationPolicyForm.provider,
        model: translationPolicyForm.model,
        apiBaseUrl: translationPolicyForm.apiBaseUrl,
        cacheEnabled: translationPolicyForm.cacheEnabled,
        timeoutSeconds: Number(translationPolicyForm.timeoutSeconds),
        maxRetries: Number(translationPolicyForm.maxRetries),
        rateLimitPerMinute: Number(translationPolicyForm.rateLimitPerMinute),
        circuitFailureThreshold: Number(translationPolicyForm.circuitFailureThreshold),
        circuitRecoverySeconds: Number(translationPolicyForm.circuitRecoverySeconds),
        inputCostPerMillionTokens: translationPolicyForm.inputCostPerMillionTokens === "" ? null : Number(translationPolicyForm.inputCostPerMillionTokens),
        outputCostPerMillionTokens: translationPolicyForm.outputCostPerMillionTokens === "" ? null : Number(translationPolicyForm.outputCostPerMillionTokens),
        costPerMillionUnits: translationPolicyForm.costPerMillionUnits === "" ? null : Number(translationPolicyForm.costPerMillionUnits),
        costUnit: translationPolicyForm.costUnit,
        ...(translationPolicyForm.apiKey ? { apiKey: translationPolicyForm.apiKey } : {}),
      };
      await updateTranslationPolicy(token, payload);
      await refreshTranslationState(token);
      setMessage("번역 Provider 정책을 저장했습니다. 비밀키 원문은 다시 표시하지 않습니다.");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "번역 Provider 정책 저장 실패");
    } finally {
      setTranslationLoading(false);
    }
  }

  function applyTranslationProviderSelection(provider: string) {
    const option = translationPolicy?.providerOptions.find((item) => item.provider === provider);
    setTranslationPolicyForm((current) => ({
      ...current,
      provider,
      apiBaseUrl: option?.apiBaseUrl ?? "",
      model: "",
      apiKey: "",
    }));
    setTranslationConnectionResult(null);
    setTranslationModelListResult(null);
    setTranslationModels([]);
    setTranslationError("");
  }

  async function loadTranslationProviderModels() {
    if (!token) return;
    setTranslationLoading(true);
    setTranslationModelListResult(null);
    setTranslationConnectionResult(null);
    setTranslationError("");
    try {
      const result = await fetchTranslationProviderModels(token, {
        provider: translationPolicyForm.provider,
        apiBaseUrl: translationPolicyForm.apiBaseUrl.trim(),
        timeoutSeconds: Number(translationPolicyForm.timeoutSeconds),
        ...(translationPolicyForm.apiKey ? { apiKey: translationPolicyForm.apiKey } : {}),
      });
      setTranslationModelListResult(result);
      setTranslationModels(result.models);
      if (result.success) {
        setTranslationPolicyForm((current) => ({
          ...current,
          model: result.models.includes(current.model) ? current.model : (result.models[0] ?? ""),
        }));
      }
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Provider 모델 목록 조회 실패");
      setTranslationModels([]);
    } finally {
      setTranslationLoading(false);
    }
  }

  async function runTranslationProviderConnectionTest() {
    if (!token) return;
    setTranslationLoading(true);
    setTranslationConnectionResult(null);
    setTranslationError("");
    try {
      const result = await testTranslationProviderConnection(token, {
        provider: translationPolicyForm.provider,
        model: translationPolicyForm.model.trim(),
        apiBaseUrl: translationPolicyForm.apiBaseUrl.trim(),
        timeoutSeconds: Number(translationPolicyForm.timeoutSeconds),
        ...(translationPolicyForm.apiKey ? { apiKey: translationPolicyForm.apiKey } : {}),
      });
      setTranslationConnectionResult(result);
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "LLM Provider 연결 테스트 실패");
    } finally {
      setTranslationLoading(false);
    }
  }

  async function runTranslationReviewAction(action: "edit" | "approve" | "retranslate") {
    if (!token || !selectedTranslationReviewId) return;
    if (action === "edit" && !translationReviewDraft.trim()) {
      setTranslationError("수정 번역문을 입력하세요.");
      return;
    }
    setTranslationLoading(true);
    setTranslationError("");
    try {
      const updated = await applyTranslationReviewAction(token, selectedTranslationReviewId, {
        action,
        ...(action === "edit" ? { translatedText: translationReviewDraft.trim() } : {}),
      });
      setTranslationReviewDraft(updated.translatedText);
      const reviews = await fetchTranslationReviews(token, translationReviewStatus === "all" ? undefined : translationReviewStatus);
      setTranslationReviews(reviews.items);
      setMessage(action === "edit" ? "번역문 수정 이력을 저장했습니다." : action === "approve" ? "번역을 승인했습니다." : "Provider 재번역을 완료했습니다.");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "번역 검수 작업 실패");
    } finally {
      setTranslationLoading(false);
    }
  }

  async function runTranslationDemo(event?: FormEvent) {
    event?.preventDefault();
    if (!token) {
      setTranslationError("로그인 후 번역 데모를 실행하세요.");
      return;
    }
    const trimmed = translationSource.trim();
    if (!trimmed) {
      setTranslationError("번역 원문을 입력하세요.");
      return;
    }
    const sourceLocale = translationSourceLocale;
    setTranslationLoading(true);
    setTranslationError("");
    try {
      const payload: TranslationRequest = {
        texts: [{ text: trimmed, sourceLocale, targetLocale: normalizeTranslationLocale(translationTargetLocale) }],
        includeSource: true,
        useCache: true,
      };
      const response: TranslationResponse = await requestTranslation(payload, token);
      setTranslationResult(response.items);
      const reviews = await fetchTranslationReviews(token, translationReviewStatus === "all" ? undefined : translationReviewStatus);
      setTranslationReviews(reviews.items);
      if (!response.fallbackUsed && response.providerAvailable) {
        setMessage("번역 호출 성공");
      }
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "번역 실패");
      setTranslationResult([]);
    } finally {
      setTranslationLoading(false);
    }
  }

  useEffect(() => {
    void refreshHealth().catch((error) => {
      setErrors([error instanceof Error ? error.message : "상태 조회 실패"]);
    });
    void refreshPublicUiContract();
    void refreshTranslationState();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => {
      setMessage("");
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (token && health?.initialized) {
      void refreshDirectory(token).catch((error) => {
        resetAdminSession(error instanceof Error ? error.message : "관리 데이터 조회 실패");
      });
      void refreshMonitoring(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "운영 모니터링 조회 실패"]);
      });
      void refreshMailDelivery(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "자체 SMTP 상태 조회 실패"]);
      });
      void refreshAdminMessengerRooms(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "메신저 대화방 조회 실패"]);
      });
      void refreshApprovalAuditLogs(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "결재 감사 로그 조회 실패"]);
      });
      void refreshContentOperations(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "콘텐츠 운영 목록 조회 실패"]);
      });
      void refreshTranslationState(token).catch((error) => {
        setTranslationError(error instanceof Error ? error.message : "번역 상태 조회 실패");
      });
      void reloadUiContract(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "UI 계약 조회 실패"]);
      });
      return;
    }
    setTranslationPolicy(null);
  }, [token, health?.initialized]);

  async function handleValidate(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await validateSetup({
        companyName: form.companyName,
        domain: form.domain,
        adminEmail: form.adminEmail,
        relayType: form.relayType,
        storagePath: form.storagePath,
        dbConfig: {
          host: form.dbHost,
          port: Number(form.dbPort),
          database: form.dbName,
          user: form.dbUser,
          password: form.dbPassword,
        },
      });
      setErrors(response.errors ?? []);
      setWarnings(normalizeWarnings(response.warnings));
      setMessage(response.is_valid ? "검증 통과" : "검증 실패");
    } finally {
      setLoading(false);
    }
  }

  async function handleInitialize() {
    setLoading(true);
    setMessage("");
    setErrors([]);
    try {
      const response = await initializeSetup({
        company: {
          name: form.companyName,
          domain: form.domain,
        },
        adminUser: {
          name: form.adminName,
          email: form.adminEmail,
          password: form.adminPassword,
        },
        domain: form.domain,
        mailProvider: {
          provider_type: form.relayType,
          relay_host: form.relayHost,
          relay_port: Number(form.relayPort),
          username: form.relayUsername,
          password: form.relayPassword,
        },
        storage: {
          driver: "local",
          local_path: form.storagePath,
        },
        dbConfig: {
          host: form.dbHost,
          port: Number(form.dbPort),
          database: form.dbName,
          user: form.dbUser,
          password: form.dbPassword,
        },
      });
      setWarnings([]);
      setMessage("초기 설정 저장 결과를 확인 중입니다.");
      if (!response.initialized) {
        throw new Error("초기 설정 저장 응답이 완료 상태가 아닙니다.");
      }
      const nextHealth = await refreshHealth();
      if (nextHealth.initialized !== true) {
        throw new Error("초기 설정 저장 후 health.initialized=true 상태를 확인하지 못했습니다.");
      }
      setMessage(response.message);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "초기 설정 저장 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (publicUiContractState !== "ready") {
      setErrors(["회사 도메인을 확인한 후 로그인할 수 있습니다."]);
      return;
    }
    const companyDomain = uiContractDraft.company.domain.trim();
    if (!companyDomain) {
      setErrors(["회사 도메인을 확인한 후 로그인할 수 있습니다."]);
      return;
    }
    setLoading(true);
    setErrors([]);
    setMessage("");
    try {
      if (loginForm.loginId.includes("@")) {
        setErrors(["아이디만 입력하세요. 회사 도메인은 자동으로 적용됩니다."]);
        return;
      }
      const response = await login({
        email: buildCompanyLoginEmail(loginForm.loginId, companyDomain),
        password: loginForm.password,
      });
      storeToken(response.accessToken);
      setToken(response.accessToken);
      await refreshDirectory(response.accessToken);
      await refreshMailDelivery(response.accessToken);
      await refreshAdminMessengerRooms(response.accessToken);
      await refreshTranslationState(response.accessToken);
      await reloadUiContract(response.accessToken);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "로그인 실패"]);
    } finally {
      setLoading(false);
    }
  }

  function resetDepartmentEditor() {
    setDepartmentEditingId("");
    setDepartmentName("");
    setDepartmentParentId("");
  }

  async function handleDepartmentSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      if (departmentEditingId) {
        await updateDepartment(token, departmentEditingId, {
          name: departmentName,
          parentId: departmentParentId || null,
          sortOrder: 100,
        });
        setMessage("부서 정보가 수정되었습니다.");
      } else {
        await createDepartment(token, {
          name: departmentName,
          parentId: departmentParentId || null,
          sortOrder: 100,
        });
        setMessage("부서가 생성되었습니다.");
      }
      resetDepartmentEditor();
      setManagementDialog(null);
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : departmentEditingId ? "부서 수정 실패" : "부서 생성 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDepartmentStatus(departmentId: string, nextStatus: "active" | "inactive") {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await updateDepartment(token, departmentId, { status: nextStatus });
      setMessage(`부서 상태를 ${nextStatus}로 변경했습니다.`);
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "부서 상태 변경 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDepartmentDelete(departmentId: string, departmentNameValue: string) {
    if (!token) return;
    if (!window.confirm(`부서 '${departmentNameValue}'를 삭제 상태로 전환하시겠습니까?`)) {
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      await deleteDepartment(token, departmentId);
      if (departmentEditingId === departmentId) {
        resetDepartmentEditor();
      }
      setMessage("부서를 삭제 상태로 전환했습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "부서 삭제 실패"]);
    } finally {
      setLoading(false);
    }
  }

  function handleRolePermissionToggle(code: string, checked: boolean) {
    setRoleSelectedPermissions((current) => {
      const next = checked ? [...current, code] : current.filter((item) => item !== code);
      return normalizePermissionCodes(next);
    });
  }

  function handleRoleGroupSelection(codes: string[], checked: boolean) {
    setRoleSelectedPermissions((current) => {
      const next = checked
        ? [...current, ...codes]
        : current.filter((item) => !codes.includes(item));
      return normalizePermissionCodes(next);
    });
  }

  function resetRoleEditor() {
    setRoleEditingId("");
    setRoleName("");
    setRoleSelectedPermissions(defaultRolePermissions);
    setRoleEditorOpen(false);
  }

  function applyRoleToOverview(nextRole: Role) {
    setOverview((current) => {
      if (!current) {
        return current;
      }
      const exists = current.roles.some((item) => item.id === nextRole.id);
      const nextRoles = exists
        ? current.roles.map((item) => (item.id === nextRole.id ? nextRole : item))
        : [...current.roles, nextRole];
      return {
        ...current,
        roles: nextRoles,
      };
    });
  }

  async function handleRoleCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const savedRole = roleEditingId
        ? await updateRole(token, roleEditingId, {
            name: roleName,
            permissions: normalizedRoleSelectedPermissions,
          })
        : await createRole(token, {
            name: roleName,
            permissions: normalizedRoleSelectedPermissions,
          });
      applyRoleToOverview({
        ...savedRole,
        name: roleName.trim(),
        permissions: normalizedRoleSelectedPermissions,
      });
      setSelectedRoleLookupId(savedRole.id);
      setMessage(roleEditingId ? "권한 역할이 수정되었습니다." : "권한 역할이 생성되었습니다.");
      resetRoleEditor();
      setManagementDialog(null);
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : roleEditingId ? "권한 수정 실패" : "권한 생성 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleUserSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      if (userForm.userId) {
        await updateUser(token, userForm.userId, {
          name: userForm.name,
          ...(userForm.password ? { password: userForm.password } : {}),
          departmentId: userForm.departmentId,
          roleId: userForm.roleId,
          status: userForm.status,
        });
        setMessage("사용자 정보가 수정되었습니다.");
      } else {
        await createUser(token, {
          name: userForm.name,
          loginId: userForm.loginId,
          password: userForm.password,
          departmentId: userForm.departmentId,
          roleId: userForm.roleId,
          status: userForm.status,
          userType: "user",
        });
        setMessage("사용자가 생성되었습니다. 입력한 초기 비밀번호를 사용자에게 안전하게 전달하세요.");
      }
      setUserForm((current) => ({
        ...initialUserForm,
        departmentId: current.departmentId,
        roleId: current.roleId,
      }));
      setManagementDialog(null);
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "사용자 저장 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleUserStatus(userId: string, nextStatus: "active" | "inactive") {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await updateUser(token, userId, { status: nextStatus });
      setMessage(nextStatus === "active" ? "사용자와 메일 계정을 활성화했습니다." : "사용자와 메일 계정을 비활성화했습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "사용자 상태 변경 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleUserDelete(userId: string, userName: string) {
    if (!token) return;
    if (!window.confirm(`사용자 '${userName}'를 삭제 상태로 전환하시겠습니까?`)) {
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      await deleteUser(token, userId);
      if (userForm.userId === userId) {
        setUserForm((current) => ({
          ...initialUserForm,
          departmentId: current.departmentId,
          roleId: current.roleId,
        }));
      }
      setMessage("사용자를 삭제 상태로 전환했습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "사용자 삭제 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleOrgImportTemplateDownload() {
    if (!token) return;
    setErrors([]);
    try {
      const blob = await downloadOrgImportTemplate(token);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "moaworks-org-import-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage("조직/사용자 업로드 템플릿을 다운로드했습니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "템플릿 다운로드 실패"]);
    }
  }

  function handleOrgImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setOrgImportFile(nextFile);
    setOrgImportBatch(null);
    setOrgImportConfirmChecked(false);
    setOrgImportConfirmationText("");
    if (nextFile) {
      setMessage(`업로드 파일 선택: ${nextFile.name}`);
      setErrors([]);
    }
  }

  async function handleOrgImportValidate() {
    if (!token || !orgImportFile) {
      setErrors(["검증할 엑셀 파일을 먼저 선택하세요."]);
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      const batch = await validateOrgImport(token, orgImportFile, orgImportDeactivationScope);
      setOrgImportBatch(batch);
      setOrgImportConfirmChecked(false);
      setOrgImportConfirmationText("");
      setOrgImportHistory((current) => [batch, ...current.filter((item) => item.batchId !== batch.batchId)].slice(0, 5));
      setMessage(batch.errors.length === 0 ? "업로드 검증이 완료되었습니다." : "업로드 검증 결과에 오류가 있습니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "업로드 검증 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleOrgImportApply() {
    if (!token || !orgImportBatch) {
      setErrors(["적용할 검증 배치가 없습니다."]);
      return;
    }
    if (orgImportBatch.errors.length > 0) {
      setErrors(["검증 오류가 남아 있어 적용할 수 없습니다."]);
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      const applied = await applyOrgImport(token, {
        batchId: orgImportBatch.batchId,
        confirmDeactivateMissingUsers: orgImportConfirmChecked,
        confirmationText: orgImportConfirmationText.trim(),
      });
      setOrgImportBatch(applied);
      setOrgImportHistory((current) => [applied, ...current.filter((item) => item.batchId !== applied.batchId)].slice(0, 5));
      await refreshDirectory();
      const latest = await fetchOrgImportBatch(token, applied.batchId);
      setOrgImportBatch(latest);
      setOrgImportHistory((current) => [latest, ...current.filter((item) => item.batchId !== latest.batchId)].slice(0, 5));
      setMessage("조직/사용자 일괄 업로드가 반영되었습니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "업로드 적용 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleStatus(roleId: string, nextStatus: "active" | "inactive") {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await updateRole(token, roleId, { status: nextStatus });
      setMessage(`권한 역할 상태를 ${nextStatus}로 변경했습니다.`);
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "권한 상태 변경 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleDelete(roleId: string, roleNameValue: string) {
    if (!token) return;
    if (!window.confirm(`권한 역할 '${roleNameValue}'를 삭제 상태로 전환하시겠습니까?`)) {
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      await deleteRole(token, roleId);
      if (roleEditingId === roleId) {
        resetRoleEditor();
      }
      if (selectedRoleLookupId === roleId) {
        setSelectedRoleLookupId("");
      }
      setMessage("권한 역할을 삭제 상태로 전환했습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "권한 역할 삭제 실패"]);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(ids: string[], id: string, checked: boolean, update: (next: string[]) => void) {
    update(checked ? Array.from(new Set([...ids, id])) : ids.filter((item) => item !== id));
  }

  function openUserDialog(user?: DirectoryOverview["users"][number]) {
    setBulkActionError("");
    setUserForm(user ? {
      userId: user.userId,
      name: user.userName,
      loginId: user.userEmail.split("@")[0] || "",
      password: "",
      departmentId: user.departmentId,
      roleId: user.roleId,
      status: user.status === "deleted" ? "inactive" : user.status,
      userType: user.userType,
    } : {
      ...initialUserForm,
      departmentId: activeDepartments.find((item) => item.status === "active")?.id || activeDepartments[0]?.id || "",
      roleId: activeRoles.find((item) => item.name === "일반사용자")?.id || activeRoles[0]?.id || "",
    });
    setManagementDialog("user");
  }

  function openDepartmentDialog(department?: DepartmentItem) {
    setBulkActionError("");
    setDepartmentEditingId(department?.id ?? "");
    setDepartmentName(department?.name ?? "");
    setDepartmentParentId(department?.parentId ?? "");
    setManagementDialog("department");
  }

  function openRoleDialog(role?: Role) {
    setBulkActionError("");
    setRoleEditingId(role?.id ?? "");
    setRoleName(role?.name ?? "");
    setRoleSelectedPermissions(role ? normalizePermissionCodes(role.permissions) : defaultRolePermissions);
    setSelectedRoleLookupId(role?.id ?? "");
    setRoleEditorOpen(true);
    setManagementDialog("role");
  }

  function closeManagementDialog() {
    if (loading) return;
    setManagementDialog(null);
    setRoleEditorOpen(false);
    setBulkActionError("");
  }

  function requestBulkAction(target: BulkTarget, action: BulkAction, ids: string[]) {
    if (ids.length === 0) return;
    setBulkActionError("");
    setBulkConfirmation({ target, action, ids });
  }

  async function executeBulkAction() {
    if (!token || !bulkConfirmation) return;
    const { target, action, ids } = bulkConfirmation;
    setLoading(true);
    setBulkActionError("");
    setErrors([]);
    try {
      for (const id of ids) {
        if (target === "users") {
          if (action === "delete") await deleteUser(token, id);
          else await updateUser(token, id, { status: action });
        }
        if (target === "departments") {
          if (action === "delete") await deleteDepartment(token, id);
          else await updateDepartment(token, id, { status: action });
        }
        if (target === "roles") {
          if (action === "delete") await deleteRole(token, id);
          else await updateRole(token, id, { status: action });
        }
      }
      setMessage(`${ids.length}개 항목을 ${action === "delete" ? "삭제 상태" : action === "active" ? "활성" : "비활성"}으로 변경했습니다.`);
      setBulkConfirmation(null);
      if (target === "users") setSelectedUserIds([]);
      if (target === "departments") setSelectedDepartmentIds([]);
      if (target === "roles") setSelectedRoleIds([]);
      await refreshDirectory();
    } catch (error) {
      setBulkActionError(error instanceof Error ? error.message : "일괄 작업에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDomainVerify(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const response = await verifyDomain(token, domainInput);
      setDomainResult(response);
      setMessage(`도메인 검증 결과: ${response.overallStatus}`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "도메인 검증 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRelayTest(event: FormEvent) {
    event.preventDefault();
    if (!token || !overview) return;
    setLoading(true);
    setErrors([]);
    try {
      const response = await testRelay(token, {
        providerConfigId: overview.mailProvider.id,
        testRecipient: relayRecipient,
      });
      setRelayResult(response);
      setMessage(`Relay 테스트 결과: ${response.status}`);
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Relay 테스트 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMailDeliveryTest(event: FormEvent) {
    event.preventDefault();
    if (!token || !relayRecipient.trim()) return;
    setLoading(true);
    setErrors([]);
    try {
      const response = await testMailOperationsProvider(token, mailProviderOperationsForm.providerKey, relayRecipient.trim());
      setMailDeliveryTestResult({ mailId: `provider-test-${response.providerId}`, status: response.lastTestStatus, sentAt: response.lastConnectionAt });
      setMessage(`${response.providerKey} 실제 외부 SMTP 테스트 결과: ${response.lastTestStatus}`);
      await refreshMailDelivery();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "메일 제공자 연결 테스트 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMailDeliveryRetry(queueId: string) {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const response = await retryMailDelivery(token, queueId);
      setMessage(response.message);
      await refreshMailDelivery();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "외부 발송 재시도 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMailDomainOperationsSave(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await updateMailOperationsDomain(token, {
        registeredDomain: mailDomainOperationsForm.registeredDomain,
        mailDomain: mailDomainOperationsForm.mailDomain,
        adminAccessMode: mailDomainOperationsForm.adminAccessMode,
        adminAllowedCidrs: mailDomainOperationsForm.adminAllowedCidrs.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      });
      await refreshMailDelivery();
      setMessage("메일 도메인과 관리자 접근 정책을 저장했습니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "메일 도메인 정책 저장 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMailProviderOperationsSave(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const payload: Record<string, unknown> = {
        relayHost: mailProviderOperationsForm.relayHost,
        relayPort: Number(mailProviderOperationsForm.relayPort),
        tlsMode: mailProviderOperationsForm.tlsMode,
        senderAddress: mailProviderOperationsForm.senderAddress || null,
        username: mailProviderOperationsForm.username || null,
        dkimDomain: mailProviderOperationsForm.dkimDomain || null,
        dkimSelector: mailProviderOperationsForm.dkimSelector || null,
      };
      if (mailProviderOperationsForm.password) payload.password = mailProviderOperationsForm.password;
      if (mailProviderOperationsForm.dkimPrivateKey) payload.dkimPrivateKey = mailProviderOperationsForm.dkimPrivateKey;
      await updateMailOperationsProvider(token, mailProviderOperationsForm.providerKey, payload);
      await refreshMailDelivery();
      setMessage("발신 Provider 설정을 저장했습니다. 변경 후 연결 테스트가 필요합니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "발신 Provider 저장 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMailProviderSwitch(targetProvider: "self_hosted" | "oci_email_delivery") {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const result = await switchMailOperationsProvider(token, targetProvider);
      await refreshMailDelivery();
      setMessage(`신규 메일 Provider를 ${result.activeProvider}(으)로 전환했습니다. 기존 큐 ${result.pinnedQueueCount}건은 원 Provider를 유지합니다.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Provider 전환 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleMailProviderRollback() {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const result = await rollbackMailOperationsProvider(token);
      await refreshMailDelivery();
      setMessage(`Provider를 ${result.activeProvider}(으)로 되돌렸습니다.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Provider rollback 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleOciSuppressionSync() {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      const result = await syncOciMailSuppressions(token);
      await refreshMailDelivery();
      setMessage(`OCI suppression ${result.suppressionCount}건을 동기화했습니다.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "OCI suppression 동기화 실패"]);
    } finally {
      setLoading(false);
    }
  }

  const isPublicLoginContractPending = health?.initialized === true && !token && publicUiContractState === "pending";
  const isHealthPending = health === null || isPublicLoginContractPending;
  const initialized = health?.initialized === true;
  const showSetupWizard = health?.initialized === false;
  const showLoginPanel = initialized && (!token || !overview) && (Boolean(token) || publicUiContractState !== "pending");
  const hasStoredSessionButNoOverview = initialized && Boolean(token) && !overview;
  const supportedTranslationTargets = translationPolicy?.supportedTargetLocales?.length ? translationPolicy.supportedTargetLocales : (translationStatus?.supportedTargetLocales ?? ["en"]);
  const translationUiVisible = translationStatus?.available === true;
  const selectedTranslationReview = translationReviews.find((item) => item.id === selectedTranslationReviewId) ?? null;
  const activeMenu = adminMenus.find((item) => item.key === activeAdminMenu) ?? adminMenus[0];
  const showAdminConsole = initialized && Boolean(token) && Boolean(overview);
  const uniqueErrors = normalizeWarnings(errors);
  const visibleWarnings = normalizeWarnings(warnings).filter((item) => !uniqueErrors.includes(item));
  const alertItems = [
    ...uniqueErrors.map((item) => ({ level: "error" as const, text: item })),
    ...visibleWarnings.map((item) => ({ level: "warning" as const, text: item })),
    ...(translationError ? [{ level: "warning" as const, text: translationError }] : []),
    ...(message ? [{ level: "success" as const, text: message }] : []),
  ];
  const alertSummaryCount = alertItems.length + (monitoringOverview?.alertOpenCount ?? 0);
  const normalizedRoleSelectedPermissions = normalizePermissionCodes(roleSelectedPermissions);
  const selectedPermissionCount = normalizedRoleSelectedPermissions.length;
  const roleUnknownPermissions = normalizedRoleSelectedPermissions.filter((code) => !knownPermissionCodeSet.has(code));
  const orgImportNeedsDeactivationConfirmation = Boolean(orgImportBatch && orgImportBatch.deactivatedUserCount > 0);
  const orgImportHasProtectedUsers = Boolean(orgImportBatch && orgImportBatch.protectedUsers.length > 0);
  const orgImportExpectedConfirmationText = orgImportBatch?.deactivationScope === "company_all"
    ? ORG_IMPORT_COMPANY_ALL_CONFIRMATION_TEXT
    : ORG_IMPORT_DEACTIVATION_CONFIRMATION_TEXT;
  const orgImportConfirmationSatisfied = !orgImportNeedsDeactivationConfirmation || orgImportConfirmChecked || orgImportConfirmationText.trim() === orgImportExpectedConfirmationText;
  const orgImportReadyToApply = Boolean(
    orgImportBatch
    && orgImportBatch.errors.length === 0
    && orgImportBatch.validationStatus === "passed"
    && !orgImportHasProtectedUsers
    && orgImportConfirmationSatisfied,
  );
  const selectedPermissionPreviewItems = normalizedRoleSelectedPermissions.map((code) => {
    const option = permissionOptionMap.get(code);
    return {
      code,
      label: option?.label ?? code,
    };
  });
  const visibleStatusMatcher = (status: string, filter: string) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "visible") {
      return status !== "deleted";
    }
    return status === filter;
  };
  const filteredUsers = overview?.users.filter((item) => {
    if (!visibleStatusMatcher(item.status, userStatusFilter)) {
      return false;
    }
    if (!userSearch.trim()) {
      return true;
    }
    const keyword = userSearch.trim().toLowerCase();
    return (
      item.userName.toLowerCase().includes(keyword) ||
      item.userEmail.toLowerCase().includes(keyword) ||
      item.departmentName.toLowerCase().includes(keyword) ||
      item.roleName.toLowerCase().includes(keyword)
    );
  }) ?? [];
  const departmentHierarchy = overview ? buildDepartmentHierarchy(overview.departments) : { rows: [], pathMap: new Map<string, string>() };
  const filteredDepartmentRows = departmentHierarchy.rows.filter((row) => {
    if (!visibleStatusMatcher(row.item.status, departmentStatusFilter)) return false;
    const keyword = departmentSearch.trim().toLowerCase();
    return !keyword || [row.item.name, row.item.systemDepartmentCode ?? "", row.item.departmentCode ?? "", row.path].some((value) => value.toLowerCase().includes(keyword));
  });
  const selectableDepartmentRows = departmentHierarchy.rows.filter((row) => row.item.status !== "deleted" && row.item.id !== departmentEditingId);
  const selectedDepartmentParent = overview?.departments.find((item) => item.id === departmentParentId) ?? null;
  const departmentPathPreview = departmentName.trim()
    ? [selectedDepartmentParent ? departmentHierarchy.pathMap.get(selectedDepartmentParent.id) ?? selectedDepartmentParent.name : "최상위", departmentName.trim()]
        .filter(Boolean)
        .join(" > ")
    : "부서명을 입력하면 생성 경로를 미리 보여줍니다.";
  const activeDepartments = overview?.departments.filter((item) => item.status !== "deleted") ?? [];
  const activeRoles = overview?.roles.filter((item) => item.status !== "deleted") ?? [];
  const normalizedUserLoginId = userForm.loginId.trim().toLowerCase();
  const userEmailPreview = overview
    ? normalizedUserLoginId
      ? `${normalizedUserLoginId}@${overview.company.domain}`
      : `아이디@${overview.company.domain}`
    : "";
  const userTypeSummary = userForm.userId
    ? userForm.userType === "admin"
      ? "관리자(admin)"
      : "일반 사용자(user)"
    : "일반 사용자(user) 자동 생성";
  const filteredApprovalAuditLogs = approvalAuditLogs.filter((item) => {
    if (!approvalSearch.trim()) {
      return true;
    }
    const keyword = approvalSearch.trim().toLowerCase();
    return [item.event, item.targetId, item.actorUserName, item.reason ?? "", item.statusBefore ?? "", item.statusAfter ?? ""]
      .some((value) => value.toLowerCase().includes(keyword));
  });
  const filteredRoles = overview?.roles.filter((item) => {
    if (!visibleStatusMatcher(item.status, roleStatusFilter)) {
      return false;
    }
    if (!roleSearch.trim()) {
      return true;
    }
    const keyword = roleSearch.trim().toLowerCase();
    return item.name.toLowerCase().includes(keyword) || item.permissions.some((permission) => permission.toLowerCase().includes(keyword));
  }) ?? [];
  const selectedRoleLookup = overview?.roles.find((item) => item.id === selectedRoleLookupId) ?? null;
  const roleUserCounts = new Map<string, number>();
  for (const user of overview?.users ?? []) {
    if (user.status !== "deleted") {
      roleUserCounts.set(user.roleId, (roleUserCounts.get(user.roleId) ?? 0) + 1);
    }
  }
  const selectedRoleConnectedUserCount = selectedRoleLookup ? roleUserCounts.get(selectedRoleLookup.id) ?? 0 : 0;
  const selectedRoleLookupPermissions = (selectedRoleLookup?.permissions ?? []).map((code) => ({
    code,
    label: permissionOptionMap.get(code)?.label ?? code,
  }));

  const filteredContentMessages = contentMessages.filter((item) => {
    const matchesSearch = !messageSearch.trim() || [item.key, item.category].join(" ").toLowerCase().includes(messageSearch.trim().toLowerCase());
    const matchesStatus = messageStatusFilter === "all" || (messageStatusFilter === "visible" ? item.status !== "deleted" : item.status === messageStatusFilter);
    return matchesSearch && matchesStatus;
  });
  const filteredHelpPolicies = helpPolicies.filter((item) => {
    const matchesSearch = !helpSearch.trim() || [item.code, item.title, item.category].join(" ").toLowerCase().includes(helpSearch.trim().toLowerCase());
    const matchesStatus = helpStatusFilter === "all" || (helpStatusFilter === "visible" ? item.status !== "deleted" : item.status === helpStatusFilter);
    return matchesSearch && matchesStatus;
  });
  const contentDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString("ko-KR") : "-";

  const renderContentMessagesPanel = () => (
    <section className="panel ops-panel content-ops-panel">
      <div className="ops-shell content-ops-shell">
        <div className="panel-head ops-head"><div><h2>다국어/메시지</h2></div><div className="ops-head-actions"><span className={`badge ${translationStatus?.available ? "badge-ok" : "badge-warning"}`}>Provider {translationStatus?.provider ?? "확인 중"}</span><span className="mini-stat">검수 {translationReviews.length}건</span><span className="mini-stat">메시지 {filteredContentMessages.length}/{contentMessages.length}건</span></div></div>
        <div className="ops-list-panel">
          <div className="ops-list-head"><strong>번역 Provider 운영</strong><span className="muted">API 키는 암호화 저장되며 저장 후 원문을 다시 표시하지 않습니다.</span></div>
          <form className="ops-toolbar-grid" onSubmit={saveTranslationProviderPolicy}>
            <label className="compact-field"><span>LLM Provider</span><select value={translationPolicyForm.provider} onChange={(event) => applyTranslationProviderSelection(event.target.value)}><option value="disabled">선택 안 함</option>{translationPolicy?.providerOptions.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}</select></label>
            <label className="compact-field"><span>모델</span><select value={translationPolicyForm.model} disabled={translationModels.length === 0} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, model: event.target.value }))}><option value="">모델 불러오기 후 선택</option>{translationModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
            <label className="compact-field compact-field-wide"><span>API Base URL</span><input value={translationPolicyForm.apiBaseUrl} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, apiBaseUrl: event.target.value }))} placeholder="Provider 선택 시 기본 주소가 입력됩니다." /></label>
            <label className="compact-field"><span>API 키 {translationPolicy?.provider === translationPolicyForm.provider && translationPolicy.apiKeyConfigured ? "(설정됨)" : translationPolicy?.providerOptions.find((item) => item.provider === translationPolicyForm.provider)?.apiKeyRequired === false ? "(선택)" : "(미설정)"}</span><input type="password" autoComplete="new-password" value={translationPolicyForm.apiKey} onChange={(event) => { setTranslationPolicyForm((current) => ({ ...current, apiKey: event.target.value, model: "" })); setTranslationConnectionResult(null); setTranslationModelListResult(null); setTranslationModels([]); }} placeholder={translationPolicy?.provider === translationPolicyForm.provider && translationPolicy.apiKeyConfigured ? "변경할 때만 입력" : "API 키 입력"} /></label>
            <label className="compact-field"><span>Timeout(초)</span><input type="number" min="1" max="120" value={translationPolicyForm.timeoutSeconds} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, timeoutSeconds: event.target.value }))} /></label>
            <label className="compact-field"><span>재시도</span><input type="number" min="0" max="5" value={translationPolicyForm.maxRetries} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, maxRetries: event.target.value }))} /></label>
            <label className="compact-field"><span>분당 제한</span><input type="number" min="1" max="10000" value={translationPolicyForm.rateLimitPerMinute} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, rateLimitPerMinute: event.target.value }))} /></label>
            <label className="compact-field"><span>차단 실패 횟수</span><input type="number" min="1" max="100" value={translationPolicyForm.circuitFailureThreshold} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, circuitFailureThreshold: event.target.value }))} /></label>
            <label className="compact-field"><span>회복 대기(초)</span><input type="number" min="1" max="3600" value={translationPolicyForm.circuitRecoverySeconds} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, circuitRecoverySeconds: event.target.value }))} /></label>
            <label className="compact-field"><span>입력 토큰 백만 개당 비용</span><input type="number" min="0" step="0.000001" value={translationPolicyForm.inputCostPerMillionTokens} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, inputCostPerMillionTokens: event.target.value }))} placeholder="계약 입력 요율" /></label>
            <label className="compact-field"><span>출력 토큰 백만 개당 비용</span><input type="number" min="0" step="0.000001" value={translationPolicyForm.outputCostPerMillionTokens} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, outputCostPerMillionTokens: event.target.value }))} placeholder="계약 출력 요율" /></label>
            <label className="compact-field"><span>혼합 단가(호환용)</span><input type="number" min="0" step="0.000001" value={translationPolicyForm.costPerMillionUnits} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, costPerMillionUnits: event.target.value }))} placeholder="기존 계약 요율" /></label>
            <label className="compact-field"><span>비용 단위</span><select value={translationPolicyForm.costUnit} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, costUnit: event.target.value as "tokens" | "characters" }))}><option value="tokens">tokens</option><option value="characters">characters</option></select></label>
            <label className="permission-check"><input type="checkbox" checked={translationPolicyForm.cacheEnabled} onChange={(event) => setTranslationPolicyForm((current) => ({ ...current, cacheEnabled: event.target.checked }))} /><span>PostgreSQL 캐시 사용</span></label>
            <div className="actions compact-actions"><button type="button" className="secondary" disabled={translationLoading || translationPolicyForm.provider === "disabled" || !translationPolicyForm.apiBaseUrl.trim()} onClick={() => void loadTranslationProviderModels()}>모델 불러오기</button><button type="button" className="secondary" disabled={translationLoading || translationPolicyForm.provider === "disabled" || !translationPolicyForm.model.trim() || !translationPolicyForm.apiBaseUrl.trim()} onClick={() => void runTranslationProviderConnectionTest()}>연결 테스트</button><button type="submit" disabled={translationLoading || !translationPolicyForm.model.trim()}>Provider 정책 저장</button><button type="button" className="secondary" disabled={translationLoading} onClick={() => void toggleTranslationPolicy(!(translationStatus?.enabled ?? false))}>{translationStatus?.enabled ? "번역 비활성화" : "번역 활성화"}</button></div>
            {translationModelListResult ? <p className={`notice ${translationModelListResult.success ? "success" : "danger"}`}>{translationModelListResult.message} ({translationModelListResult.code})</p> : null}
            {translationConnectionResult ? <p className={`notice ${translationConnectionResult.success ? "success" : "danger"}`}>{translationConnectionResult.message} ({translationConnectionResult.provider} / {translationConnectionResult.model} / {translationConnectionResult.code})</p> : null}
          </form>
        </div>
        {translationUiVisible ? (<>
        <div className="split-panel">
          <form className="ops-list-panel" onSubmit={runTranslationDemo}>
            <div className="ops-list-head"><strong>실제 번역</strong><span className="muted">자동 감지 또는 원문 언어를 직접 선택합니다.</span></div>
            <div className="ops-toolbar-grid">
              <label className="compact-field"><span>원문 언어</span><select value={translationSourceLocale} onChange={(event) => setTranslationSourceLocale(event.target.value)}><option value="auto">자동 감지</option>{translationPolicy?.supportedSourceLocales.filter((item) => item !== "auto").map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label className="compact-field"><span>번역 언어</span><select value={translationTargetLocale} onChange={(event) => setTranslationTargetLocale(event.target.value)}>{supportedTranslationTargets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <label><span>원문</span><textarea value={translationSource} onChange={(event) => setTranslationSource(event.target.value)} /></label>
            <div className="actions compact-actions"><button type="button" disabled={translationLoading || !translationStatus?.enabled} onClick={() => void runTranslationDemo()}>번역 실행</button></div>
            {translationResult.map((item, index) => <article key={`${item.originalText}-${index}`} className="status-card"><div className="status-title"><strong>{item.sourceLocale} → {item.targetLocale}</strong><span className="badge">{item.cacheHit ? "DB cache" : item.provider}</span></div><p>{item.translatedText}</p>{item.statusMessage ? <p data-testid="translation-fallback-status" className="notice danger">번역을 완료하지 못했습니다. 원문을 유지했습니다. ({item.statusMessage})</p> : null}<p className="muted">모델 {item.model || "-"} / 검수 {item.reviewId ?? "캐시 결과"}</p></article>)}
          </form>
          <div className="ops-list-panel">
            <div className="ops-list-head"><strong>번역 검수</strong><label className="compact-field"><span>상태</span><select value={translationReviewStatus} onChange={(event) => { const next = event.target.value; setTranslationReviewStatus(next); if (token) void fetchTranslationReviews(token, next === "all" ? undefined : next).then((response) => setTranslationReviews(response.items)); }}><option value="all">전체</option><option value="pending">검수 대기</option><option value="edited">수정</option><option value="approved">승인</option><option value="failed">실패</option></select></label></div>
            <div className="table-wrap ops-scroll"><table className="data-table"><thead><tr><th>원문</th><th>언어</th><th>Provider</th><th>상태</th><th>수정일</th></tr></thead><tbody>{translationReviews.map((item) => <tr key={item.id} className="management-list-row" onClick={() => { setSelectedTranslationReviewId(item.id); setTranslationReviewDraft(item.translatedText); }}><td>{item.sourceText.slice(0, 40)}</td><td>{item.sourceLocale} → {item.targetLocale}</td><td>{item.provider}</td><td>{item.status}</td><td>{contentDate(item.updatedAt)}</td></tr>)}{translationReviews.length === 0 ? <tr><td colSpan={5}>검수 항목이 없습니다.</td></tr> : null}</tbody></table></div>
          </div>
        </div>
        {selectedTranslationReview ? <div className="ops-list-panel"><div className="ops-list-head"><strong>원문·번역문 비교</strong><span className="muted">{selectedTranslationReview.provider} / {selectedTranslationReview.model || "기본 모델"} / {selectedTranslationReview.status}</span></div><div className="split-panel"><label><span>원문</span><textarea value={selectedTranslationReview.sourceText} readOnly /></label><label><span>번역문</span><textarea value={translationReviewDraft} onChange={(event) => setTranslationReviewDraft(event.target.value)} /></label></div><div className="actions compact-actions"><button type="button" onClick={() => void runTranslationReviewAction("edit")} disabled={translationLoading}>수정 저장</button><button type="button" onClick={() => void runTranslationReviewAction("approve")} disabled={translationLoading || selectedTranslationReview.status === "approved"}>승인</button><button type="button" className="secondary" onClick={() => void runTranslationReviewAction("retranslate")} disabled={translationLoading || !translationStatus?.available}>재번역</button></div></div> : null}
        </>) : <p className="notice">LLM 설정과 활성화 후 번역 실행·검수 화면이 표시됩니다.</p>}
        {translationError ? <p className="notice danger">{translationError}</p> : null}
        <div className="management-list-toolbar" role="toolbar" aria-label="메시지 목록 작업">
          <label className="compact-field"><span>검색</span><input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="키 또는 분류" /></label>
          <label className="compact-field"><span>상태</span><select value={messageStatusFilter} onChange={(event) => setMessageStatusFilter(event.target.value)}><option value="visible">활성/비활성</option><option value="active">active</option><option value="inactive">inactive</option><option value="deleted">deleted</option><option value="all">전체</option></select></label>
          <span className="mini-stat">선택 {selectedMessageIds.length}건</span>
          <div className="actions compact-actions"><button type="button" onClick={() => openContentMessageDialog()} disabled={loading}>새 메시지</button><button type="button" className="secondary" onClick={() => setContentBulkDialog({ resource: "message", action: "active", ids: selectedMessageIds })} disabled={loading || selectedMessageIds.length === 0}>활성화</button><button type="button" className="secondary" onClick={() => setContentBulkDialog({ resource: "message", action: "inactive", ids: selectedMessageIds })} disabled={loading || selectedMessageIds.length === 0}>비활성화</button><button type="button" className="danger-action" onClick={() => setContentBulkDialog({ resource: "message", action: "delete", ids: selectedMessageIds })} disabled={loading || selectedMessageIds.length === 0}>삭제</button><button type="button" className="secondary" onClick={() => void refreshContentOperations()} disabled={loading}>새로고침</button></div>
        </div>
        <div className="ops-list-panel content-list-panel"><div className="table-wrap ops-scroll content-list-scroll"><table className="data-table"><thead><tr><th aria-label="선택" /><th>키</th><th>기본 언어</th><th>분류</th><th>상태</th><th>시스템</th><th>수정일</th><th>상세</th></tr></thead><tbody>{filteredContentMessages.map((item) => <tr key={item.id} className="management-list-row" onDoubleClick={() => openContentMessageDialog(item)}><td><input type="checkbox" aria-label={item.key + " 선택"} checked={selectedMessageIds.includes(item.id)} disabled={!item.canChangeStatus} onChange={() => toggleContentSelection("message", item.id)} /></td><td>{item.key}</td><td>{item.default_locale}</td><td>{item.category}</td><td><span className="badge">{item.status}</span></td><td>{item.is_system ? <span className="badge badge-warning">system</span> : "-"}</td><td>{contentDate(item.updated_at)}</td><td><button type="button" className="secondary" onClick={() => openContentMessageDialog(item)}>상세</button></td></tr>)}{filteredContentMessages.length === 0 ? <tr><td colSpan={8}>표시할 메시지가 없습니다.</td></tr> : null}</tbody></table></div></div>
      </div>
    </section>
  );

  const renderHelpPoliciesPanel = () => (
    <section className="panel ops-panel content-ops-panel">
      <div className="ops-shell content-ops-shell">
        <div className="panel-head ops-head"><div><h2>도움말/정책</h2></div><div className="ops-head-actions"><span className="mini-stat">전체 {helpPolicies.length}건</span><span className="mini-stat">조회 {filteredHelpPolicies.length}건</span></div></div>
        <div className="management-list-toolbar" role="toolbar" aria-label="정책 목록 작업">
          <label className="compact-field"><span>검색</span><input value={helpSearch} onChange={(event) => setHelpSearch(event.target.value)} placeholder="코드, 제목 또는 분류" /></label>
          <label className="compact-field"><span>상태</span><select value={helpStatusFilter} onChange={(event) => setHelpStatusFilter(event.target.value)}><option value="visible">초안/발행/비활성</option><option value="draft">draft</option><option value="published">published</option><option value="inactive">inactive</option><option value="deleted">deleted</option><option value="all">전체</option></select></label>
          <span className="mini-stat">선택 {selectedHelpIds.length}건</span>
          <div className="actions compact-actions"><button type="button" onClick={() => openHelpPolicyDialog()} disabled={loading}>새 정책</button><button type="button" className="secondary" onClick={() => setContentBulkDialog({ resource: "help", action: "published", ids: selectedHelpIds })} disabled={loading || selectedHelpIds.length === 0}>발행</button><button type="button" className="secondary" onClick={() => setContentBulkDialog({ resource: "help", action: "inactive", ids: selectedHelpIds })} disabled={loading || selectedHelpIds.length === 0}>비활성화</button><button type="button" className="danger-action" onClick={() => setContentBulkDialog({ resource: "help", action: "delete", ids: selectedHelpIds })} disabled={loading || selectedHelpIds.length === 0}>삭제</button><button type="button" className="secondary" onClick={() => void refreshContentOperations()} disabled={loading}>새로고침</button></div>
        </div>
        <div className="ops-list-panel content-list-panel"><div className="table-wrap ops-scroll content-list-scroll"><table className="data-table"><thead><tr><th aria-label="선택" /><th>코드</th><th>제목</th><th>분류</th><th>대상</th><th>상태</th><th>버전</th><th>발행일</th><th>수정일</th><th>상세</th></tr></thead><tbody>{filteredHelpPolicies.map((item) => <tr key={item.id} className="management-list-row" onDoubleClick={() => openHelpPolicyDialog(item)}><td><input type="checkbox" aria-label={item.code + " 선택"} checked={selectedHelpIds.includes(item.id)} disabled={!item.canChangeStatus} onChange={() => toggleContentSelection("help", item.id)} /></td><td>{item.code}</td><td>{item.title}</td><td>{item.category}</td><td>{item.audience}</td><td><span className="badge">{item.status}</span></td><td>{item.version}</td><td>{contentDate(item.published_at)}</td><td>{contentDate(item.updated_at)}</td><td><button type="button" className="secondary" onClick={() => openHelpPolicyDialog(item)}>상세</button></td></tr>)}{filteredHelpPolicies.length === 0 ? <tr><td colSpan={10}>표시할 정책이 없습니다.</td></tr> : null}</tbody></table></div></div>
      </div>
    </section>
  );

  const renderAdminPanel = () => {
    if (!overview) {
      return null;
    }

    const messageCategories = [
      { title: "오류", body: translationError || uniqueErrors[0] || uiContractDraft.messages.error },
      { title: "경고", body: visibleWarnings[0] || uiContractDraft.messages.warning },
      { title: "차단", body: uiContractDraft.messages.blocked },
      { title: "빈 상태", body: uiContractDraft.messages.empty },
      { title: "성공", body: message || uiContractDraft.messages.success },
      { title: "세션 만료", body: uiContractDraft.messages.sessionExpired },
    ];

    const sharedStatusCards = [
      {
        title: "메일 Relay 실패(1h)",
        value: `${monitoringOverview?.relayFailureCount1h ?? 0}건`,
        description: "1시간 내 발생",
      },
      {
        title: "승인 지연",
        value: `${monitoringOverview?.approvalBacklogCount ?? 0}건`,
        description: "미완료 결재 문서",
      },
      {
        title: "디스크 사용률",
        value: `${monitoringOverview?.diskUsagePercent ?? 0}%`,
        description: `활성 경고 ${monitoringOverview?.alertOpenCount ?? 0}건`,
      },
    ];

    switch (activeAdminMenu) {
      case "dashboard":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{copy.overviewTitle}</h2>
              </div>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => void refreshDirectory()}>
                  {copy.refreshOps}
                </button>
                <button type="button" className="secondary" onClick={() => void refreshMonitoring()}>
                  {copy.refreshMonitoring}
                </button>
                <button type="button" className="secondary" onClick={() => void reloadUiContract()}>
                  설정 저장값 다시 불러오기
                </button>
              </div>
            </div>
            {health ? (
              <>
                <div className="badge-row">
                  <span className={`badge badge-${health.status}`}>전체 상태: {health.status}</span>
                  <span className={`badge ${initialized ? "badge-ok" : "badge-warning"}`}>
                    초기 설정: {initialized ? "완료" : "미완료"}
                  </span>
                </div>
                <div className="status-grid">
                  {Object.entries(health.components).map(([name, component]) => (
                    <article key={name} className="status-card">
                      <div className="status-title">
                        <strong>{name}</strong>
                        <span className={`badge badge-${component.status}`}>{component.status}</span>
                      </div>
                      <p>{component.message}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
            <div className="overview-grid">
              {sharedStatusCards.map((item) => (
                <article key={item.title} className="status-card">
                  <strong>{item.title}</strong>
                  <p>{item.value}</p>
                </article>
              ))}
            </div>
            <div className="status-card">
              <strong>운영 이벤트(최근)</strong>
              <ul>
                {monitoringEvents.slice(0, 5).map((item) => (
                  <li key={item.eventId}>
                    [{item.severity}] {item.title}
                  </li>
                ))}
                {monitoringEvents.length === 0 ? <li>운영 이벤트가 없습니다.</li> : null}
              </ul>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>회사</strong>
                <p>{overview.company.name}</p>

              </article>
              <article className="status-card">
                <strong>사용자</strong>
                <div className="ops-head-actions">
                  <span className="mini-stat">전체 {overview.users.length}</span>
                  <span className="mini-stat">active {overview.users.filter((item) => item.status === "active").length}</span>
                </div>
              </article>
              <article className="status-card">
                <strong>부서 / 권한</strong>
                <p>{overview.departments.length}개 / {overview.roles.length}개</p>

              </article>
              <article className="status-card">
                <strong>빠른 작업</strong>
                                <div className="row-actions">
                  <button type="button" className="secondary" onClick={() => navigateAdminMenu("users")}>사용자 관리</button>
                  <button type="button" className="secondary" onClick={() => navigateAdminMenu("service")}>서비스 운영</button>
                  <button type="button" className="secondary" onClick={() => navigateAdminMenu("storage")}>저장소/DB 상태</button>
                </div>
              </article>
            </div>
          </section>
        );
      case "users":
        return (
          <section className="panel ops-panel users-ops-panel">
            <div className="ops-shell users-ops-shell">
              <div className="panel-head ops-head">
                <div>
                  <h2>{t(locale, "userManagement")}</h2>
                </div>
                <div className="ops-head-actions">
                  <span className="mini-stat">전체 {overview.users.length}명</span>
                  <span className="mini-stat">조회 {filteredUsers.length}명</span>
                  <span className="mini-stat">삭제 {overview.users.filter((item) => item.status === "deleted").length}명</span>
                </div>
              </div>
              <div className="management-list-toolbar" role="toolbar" aria-label="사용자 목록 작업">
                <label className="compact-field">
                  <span>사용자 검색</span>
                  <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="이름, 아이디, 이메일, 부서, 역할" />
                </label>
                <label className="compact-field">
                  <span>상태</span>
                  <select value={userStatusFilter} onChange={(event) => setUserStatusFilter(event.target.value)}>
                    <option value="visible">활성/비활성</option><option value="active">active</option><option value="inactive">inactive</option><option value="deleted">deleted</option><option value="all">전체</option>
                  </select>
                </label>
                <span className="mini-stat">선택 {selectedUserIds.length}명</span>
                <div className="actions compact-actions">
                  <button type="button" onClick={() => openUserDialog()} disabled={loading}>사용자 등록</button>
                  <button type="button" className="secondary" onClick={() => setManagementDialog("orgImport")} disabled={loading}>조직/사용자 일괄 업로드</button>
                  <button type="button" className="secondary" onClick={() => requestBulkAction("users", "active", selectedUserIds)} disabled={loading || selectedUserIds.length === 0}>활성화</button>
                  <button type="button" className="secondary" onClick={() => requestBulkAction("users", "inactive", selectedUserIds)} disabled={loading || selectedUserIds.length === 0}>비활성화</button>
                  <button type="button" className="danger-action" onClick={() => requestBulkAction("users", "delete", selectedUserIds)} disabled={loading || selectedUserIds.length === 0}>삭제</button>
                </div>
              </div>
              {managementDialog === "user" ? (
                <div className="management-modal-backdrop" role="presentation" onClick={closeManagementDialog}>
                  <form className="management-modal management-editor-modal" onSubmit={handleUserSubmit} onClick={(event) => event.stopPropagation()}>
                    <div className="management-modal-head"><strong>{userForm.userId ? copy.editUser : copy.createUser}</strong><button type="button" className="secondary" onClick={closeManagementDialog}>닫기</button></div>
                <div className="ops-toolbar-grid user-toolbar-grid">
                  <label className="compact-field">
                    <span>사용자 검색</span>
                    <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="이름, 이메일, 부서, 권한" />
                  </label>
                  <label className="compact-field">
                    <span>목록 상태</span>
                    <select value={userStatusFilter} onChange={(event) => setUserStatusFilter(event.target.value)}>
                      <option value="visible">활성/비활성</option>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="deleted">deleted</option>
                      <option value="all">전체</option>
                    </select>
                  </label>
                  <label className="compact-field">
                    <span>사용자 이름</span>
                    <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                  </label>
                  <label className="compact-field">
                    <span>아이디 <InlineHint label="회사 도메인과 결합해 이메일 주소를 자동 구성합니다." /></span>
                    <input value={userForm.loginId} disabled={Boolean(userForm.userId)} onChange={(e) => setUserForm({ ...userForm, loginId: e.target.value.toLowerCase() })} placeholder="hong.gildong" />
                  </label>
                  <label className="compact-field">
                    <span>{userForm.userId ? "새 비밀번호(선택)" : "초기 비밀번호"} <InlineHint label="8자 이상으로 설정하고 사용자에게 별도 보안 채널로 전달하세요." /></span>
                    <input type="password" minLength={8} required={!userForm.userId} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} autoComplete="new-password" />
                  </label>
                  <label className="compact-field">
                    <span>자동 생성 이메일</span>
                    <input value={userEmailPreview} readOnly />
                  </label>
                  <label className="compact-field">
                    <span>부서</span>
                    <select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })}>
                      {activeDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label className="compact-field">
                    <span>권한 역할 <InlineHint label="일반 사용자 생성 화면에서는 역할만 선택하고 계정 유형은 자동으로 user 처리됩니다." /></span>
                    <select value={userForm.roleId} onChange={(e) => setUserForm({ ...userForm, roleId: e.target.value })}>
                      {activeRoles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label className="compact-field">
                    <span>상태</span>
                    <select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </label>
                  <label className="compact-field">
                    <span>계정 분류</span>
                    <input value={userTypeSummary} readOnly />
                  </label>
                </div>
                <div className="actions compact-actions">
                  <button type="submit" disabled={loading}>
                    {userForm.userId ? copy.editUser : copy.createUser}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setUserForm({
                      ...initialUserForm,
                      departmentId: activeDepartments.find((item) => item.status === "active")?.id || activeDepartments[0]?.id || "",
                      roleId: activeRoles.find((item) => item.name === "일반사용자")?.id || activeRoles[0]?.id || "",
                    })}
                  >
                    {copy.newUser}
                  </button>
                  <button type="button" className="secondary" onClick={() => setManagementDialog("orgImport")}>
                    조직/사용자 일괄 업로드
                  </button>
                </div>
                  </form>
                </div>
              ) : null}
              {managementDialog === "orgImport" ? (
                <div className="org-import-modal-backdrop" role="presentation" onClick={() => { if (!loading) closeManagementDialog(); }}>
                  <section className="org-import-modal" role="dialog" aria-modal="true" aria-label="조직/사용자 일괄 업로드" onClick={(event) => event.stopPropagation()}>
                    <div className="org-import-modal-head">
                      <div>
                        <strong>조직/사용자 일괄 업로드</strong>
                        <p className="muted">검증 후 미리보기와 누락 사용자 확인을 마쳐야 실제 반영됩니다.</p>
                      </div>
                      <div className="ops-head-actions">
                        <button type="button" className="secondary" onClick={() => void handleOrgImportTemplateDownload()} disabled={loading}>템플릿 다운로드</button>
                        <button type="button" className="secondary" onClick={closeManagementDialog} disabled={loading}>닫기</button>
                      </div>
                    </div>
                    <div className="org-import-modal-body">
                      <div className="org-import-file-row">
                        <div className="compact-field org-import-file-field">
                          <span>비활성화 정책 <InlineHint label="기본 정책은 업로드 부서 범위 안의 검수용 계정만 누락 비교 대상으로 삼고, admin·cyhuh·ysla 같은 보호 계정은 별도 경고로 분리합니다." /></span>
                          <select value={orgImportDeactivationScope} onChange={(event) => setOrgImportDeactivationScope(event.target.value as "none" | "uploaded_departments_only" | "company_all")}>
                            <option value="uploaded_departments_only">업로드 부서 내 검수용 계정만 비교</option>
                            <option value="none">누락 사용자 자동 비활성화 안 함</option>
                            <option value="company_all">회사 전체 누락 비교</option>
                          </select>
                        </div>
                        <div className="compact-field org-import-file-field">
                          <span>업로드 파일 <InlineHint label="엑셀 업로드 직후에는 DB에 반영되지 않고, 검증/미리보기 후 관리자 확인을 거쳐야 적용됩니다." /></span>
                          <div className="org-import-file-picker">
                            <input
                              id="org-import-file"
                              className="org-import-file-input"
                              type="file"
                              accept=".xlsx"
                              onChange={handleOrgImportFileChange}
                            />
                            <label htmlFor="org-import-file" className="button-like secondary">파일 선택</label>
                            <div className={`org-import-file-name ${orgImportFile ? "has-file" : ""}`}>{orgImportFile?.name || "선택된 파일 없음"}</div>
                          </div>
                        </div>
                        <div className="org-import-actions">
                          <button type="button" className="secondary" onClick={() => void handleOrgImportValidate()} disabled={!orgImportFile || loading}>검증 실행</button>
                          <button type="button" onClick={() => void handleOrgImportApply()} disabled={!orgImportReadyToApply || loading}>적용 실행</button>
                        </div>
                      </div>
                      {orgImportBatch ? (
                        <div className="org-import-preview-grid">
                          <div className="ops-toolbar-meta">
                            <span className="mini-stat">기존 활성 부서 비활성 {orgImportBatch.inactiveDepartmentCount}개</span>
                            <span className="mini-stat">신규 부서 {orgImportBatch.createdDepartmentCount}개</span>
                            <span className="mini-stat">기존 사용자 이동 {orgImportBatch.movedUserCount}명</span>
                            <span className="mini-stat">신규 사용자 {orgImportBatch.createdUserCount}명</span>
                            <span className="mini-stat">누락 사용자 비활성 {orgImportBatch.deactivatedUserCount}명</span>
                            <span className="mini-stat">보호 제외 사용자 {orgImportBatch.protectedUsers.length}명</span>
                          </div>
                          <div className="org-import-preview-columns">
                            <div className="permission-preview-panel">
                              <strong>부서 미리보기</strong>
                              <div className="stack-list org-import-stack">
                                {orgImportBatch.departments.slice(0, 8).map((item) => (
                                  <span key={`${item.rowNumber}-${item.systemDepartmentCode}`} className="meta-chip org-import-chip">
                                    {item.departmentName} · {item.departmentCode} · {item.systemDepartmentCode}
                                  </span>
                                ))}
                                {orgImportBatch.departments.length === 0 ? <span className="muted">검증된 부서가 없습니다.</span> : null}
                              </div>
                            </div>
                            <div className="permission-preview-panel">
                              <strong>사용자 미리보기</strong>
                              <div className="stack-list org-import-stack">
                                {orgImportBatch.users.slice(0, 8).map((item) => (
                                  <span key={`${item.rowNumber}-${item.loginId}`} className="meta-chip org-import-chip">
                                    {item.name} · {item.loginId} · {item.departmentName || item.departmentCode} · {item.action}
                                  </span>
                                ))}
                                {orgImportBatch.users.length === 0 ? <span className="muted">검증된 사용자가 없습니다.</span> : null}
                              </div>
                            </div>
                          </div>
                          <div className="permission-preview-panel">
                            <strong>현재 비활성화 정책</strong>
                            <p className="muted">
                              {orgImportBatch.deactivationScope === "company_all"
                                ? "회사 전체 누락 비교"
                                : orgImportBatch.deactivationScope === "none"
                                  ? "자동 비활성화 안 함"
                                  : "업로드 부서 내 검수용 계정만 비교"}
                            </p>
                          </div>
                          {orgImportBatch.protectedUsers.length > 0 ? (
                            <div className="permission-preview-panel warning-list">
                              <div className="ops-list-head"><strong>보호 제외 사용자</strong><span className="mini-stat">{orgImportBatch.protectedUsers.length}명</span></div>
                              <div className="table-wrap ops-scroll org-import-deactivation-scroll"><table className="data-table"><thead><tr><th>이름</th><th>아이디</th><th>이메일</th><th>현재 부서</th><th>현재 권한 역할</th><th>현재 상태</th><th>제외 사유</th></tr></thead><tbody>{orgImportBatch.protectedUsers.map((item) => <tr key={`protected-${item.userId}`}><td>{item.name}</td><td>{item.loginId}</td><td>{item.email}</td><td>{item.currentDepartmentName}</td><td>{item.currentRoleName}</td><td>{item.currentStatus}</td><td>{item.reason}</td></tr>)}</tbody></table></div>
                              <p className="muted">보호 계정이 남아 있으면 서버 apply가 차단됩니다. 업로드 파일을 수정한 뒤 다시 검증하세요.</p>
                            </div>
                          ) : null}
                          {orgImportBatch.usersToDeactivate.length > 0 ? (
                            <div className="permission-preview-panel org-import-danger-panel">
                              <div className="ops-list-head"><strong>업로드 파일 누락으로 비활성화 예정인 기존 사용자</strong><span className="mini-stat">{orgImportBatch.usersToDeactivate.length}명</span></div>
                              <div className="table-wrap ops-scroll org-import-deactivation-scroll"><table className="data-table"><thead><tr><th>이름</th><th>아이디</th><th>이메일</th><th>현재 부서</th><th>현재 권한 역할</th><th>현재 상태</th><th>사유</th></tr></thead><tbody>{orgImportBatch.usersToDeactivate.map((item) => <tr key={item.userId}><td>{item.name}</td><td>{item.loginId}</td><td>{item.email}</td><td>{item.currentDepartmentName}</td><td>{item.currentRoleName}</td><td>{item.currentStatus}</td><td>{item.reason}</td></tr>)}</tbody></table></div>
                              <div className="org-import-confirm-box"><label className="org-import-confirm-check"><input type="checkbox" checked={orgImportConfirmChecked} onChange={(event) => setOrgImportConfirmChecked(event.target.checked)} /><span>누락 사용자 비활성화 동의</span></label><label className="compact-field"><span>확인 문구 입력</span><input value={orgImportConfirmationText} onChange={(event) => setOrgImportConfirmationText(event.target.value)} placeholder={orgImportExpectedConfirmationText} /></label>{!orgImportConfirmationSatisfied ? <p className="muted">체크 또는 확인 문구 입력 후 적용할 수 있습니다.</p> : null}</div>
                            </div>
                          ) : <div className="permission-preview-panel org-import-safe-panel"><strong>누락 사용자 비활성화 예정 없음</strong><p className="muted">이번 배치는 기존 사용자 자동 비활성화 없이 적용할 수 있습니다.</p></div>}
                          {orgImportBatch.errors.length > 0 ? <div className="message-list error-list">{orgImportBatch.errors.map((item, index) => <p key={`error-${orgImportBatch.batchId}-${index}`}>{`${item.sheet ?? "batch"}${item.rowNumber ? ` ${item.rowNumber}행` : ""}: ${item.message}`}</p>)}</div> : null}
                          {orgImportBatch.warnings.length > 0 ? <div className="message-list warning-list">{orgImportBatch.warnings.map((item, index) => <p key={`warn-${orgImportBatch.batchId}-${index}`}>{`${item.sheet ?? "batch"}${item.rowNumber ? ` ${item.rowNumber}행` : ""}: ${item.message}`}</p>)}</div> : null}
                        </div>
                      ) : null}
                      {orgImportHistory.length > 0 ? <div className="table-wrap ops-scroll org-import-history-scroll"><table className="data-table"><thead><tr><th>배치</th><th>파일명</th><th>검증</th><th>적용</th><th>누락 비활성화</th></tr></thead><tbody>{orgImportHistory.map((item) => <tr key={item.batchId}><td>{item.batchId}</td><td>{item.fileName}</td><td>{item.validationStatus}</td><td>{item.applyStatus}</td><td>{item.deactivatedUserCount}</td></tr>)}</tbody></table></div> : null}
                    </div>
                  </section>
                </div>
              ) : null}
              <div className="ops-list-panel">
                <div className="ops-list-head"><strong>사용자 목록</strong><span className="muted">행을 더블클릭하면 상세·수정 창이 열립니다.</span></div>
                <div className="table-wrap ops-scroll"><table className="data-table"><thead><tr><th><input type="checkbox" aria-label="현재 사용자 결과 전체 선택" checked={filteredUsers.length > 0 && filteredUsers.every((item) => selectedUserIds.includes(item.userId))} onChange={(event) => setSelectedUserIds(event.target.checked ? filteredUsers.map((item) => item.userId) : [])} /></th><th>이름</th><th>아이디/이메일</th><th>부서</th><th>권한 역할</th><th>사용자 상태</th><th>메일 상태</th><th>정합성</th></tr></thead><tbody>
                  {filteredUsers.map((item) => <tr key={item.userId} onDoubleClick={() => openUserDialog(item)} className="management-list-row"><td><input type="checkbox" aria-label={`${item.userName} 선택`} checked={selectedUserIds.includes(item.userId)} onChange={(event) => toggleSelection(selectedUserIds, item.userId, event.target.checked, setSelectedUserIds)} onClick={(event) => event.stopPropagation()} /></td><td>{item.userName}</td><td>{item.userEmail}</td><td>{item.departmentName}</td><td>{item.roleName}</td><td><span className={`badge ${item.status === "active" ? "badge-ok" : item.status === "deleted" ? "badge-danger" : "badge-warning"}`}>{item.status}</span></td><td>{item.mailAccountStatus}</td><td>{item.consistencyIssues.length === 0 ? "정상" : item.consistencyIssues.map((issue) => issue.code).join(", ")}</td></tr>)}
                  {filteredUsers.length === 0 ? <tr><td colSpan={8}>조건에 맞는 사용자가 없습니다.</td></tr> : null}
                </tbody></table></div>
              </div>
            </div>
          </section>
        );      case "departments":
        return (
          <section className="panel ops-panel">
            <div className="ops-shell management-shell">
              <div className="panel-head ops-head"><div><h2>부서 관리</h2></div><div className="ops-head-actions"><span className="mini-stat">전체 {overview.departments.length}개</span><span className="mini-stat">조회 {filteredDepartmentRows.length}개</span><span className="mini-stat">선택 {selectedDepartmentIds.length}개</span></div></div>
              <div className="management-list-toolbar" role="toolbar" aria-label="부서 목록 작업">
                <label className="compact-field"><span>부서 검색</span><input value={departmentSearch} onChange={(event) => setDepartmentSearch(event.target.value)} placeholder="부서명 또는 부서 코드" /></label>
                <label className="compact-field"><span>상태</span><select value={departmentStatusFilter} onChange={(event) => setDepartmentStatusFilter(event.target.value)}><option value="visible">활성/비활성</option><option value="active">active</option><option value="inactive">inactive</option><option value="deleted">deleted</option><option value="all">전체</option></select></label>
                <div className="actions compact-actions"><button type="button" onClick={() => openDepartmentDialog()} disabled={loading}>부서 등록</button><button type="button" className="secondary" onClick={() => requestBulkAction("departments", "active", selectedDepartmentIds)} disabled={loading || selectedDepartmentIds.length === 0}>활성화</button><button type="button" className="secondary" onClick={() => requestBulkAction("departments", "inactive", selectedDepartmentIds)} disabled={loading || selectedDepartmentIds.length === 0}>비활성화</button><button type="button" className="danger-action" onClick={() => requestBulkAction("departments", "delete", selectedDepartmentIds)} disabled={loading || selectedDepartmentIds.length === 0}>삭제</button></div>
              </div>
              {managementDialog === "department" ? <div className="management-modal-backdrop" role="presentation" onClick={closeManagementDialog}><form className="management-modal management-editor-modal" onSubmit={handleDepartmentSubmit} onClick={(event) => event.stopPropagation()}><div className="management-modal-head"><strong>{departmentEditingId ? "부서 수정" : "부서 등록"}</strong><button type="button" className="secondary" onClick={closeManagementDialog}>닫기</button></div><div className="ops-toolbar-grid department-toolbar-grid"><label className="compact-field"><span>부서명</span><input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} /></label><label className="compact-field"><span>상위 부서 <InlineHint label="최상위를 선택하면 루트 부서로 생성됩니다." /></span><select value={departmentParentId} onChange={(event) => setDepartmentParentId(event.target.value)}><option value="">최상위(없음)</option>{selectableDepartmentRows.map((row) => <option key={row.item.id} value={row.item.id}>{`${"  ".repeat(row.level)}${row.path}`}</option>)}</select></label><label className="compact-field compact-field-wide"><span>경로 미리보기</span><input value={departmentPathPreview} readOnly /></label></div><div className="actions compact-actions"><button type="submit" disabled={loading}>{departmentEditingId ? "저장" : "등록"}</button></div></form></div> : null}
              <div className="ops-list-panel"><div className="ops-list-head"><strong>부서 계층 목록</strong><span className="muted">행을 더블클릭하면 상세·수정 창이 열립니다.</span></div><div className="table-wrap ops-scroll"><table className="data-table"><thead><tr><th><input type="checkbox" aria-label="현재 부서 결과 전체 선택" checked={filteredDepartmentRows.length > 0 && filteredDepartmentRows.every((row) => selectedDepartmentIds.includes(row.item.id))} onChange={(event) => setSelectedDepartmentIds(event.target.checked ? filteredDepartmentRows.map((row) => row.item.id) : [])} /></th><th>구조</th><th>시스템 코드</th><th>업무 코드</th><th>경로</th><th>상위 부서</th><th>상태</th><th>연결 사용자</th></tr></thead><tbody>{filteredDepartmentRows.map((row) => <tr key={row.item.id} onDoubleClick={() => openDepartmentDialog(row.item)} className="management-list-row"><td><input type="checkbox" aria-label={`${row.item.name} 선택`} checked={selectedDepartmentIds.includes(row.item.id)} onChange={(event) => toggleSelection(selectedDepartmentIds, row.item.id, event.target.checked, setSelectedDepartmentIds)} onClick={(event) => event.stopPropagation()} /></td><td><span className="department-tree-label" style={{ paddingLeft: `${row.level * 16}px` }}>{row.level > 0 ? "└ " : "• "}{row.item.name}</span></td><td>{row.item.systemDepartmentCode ?? "-"}</td><td>{row.item.departmentCode ?? "-"}</td><td>{row.path}</td><td>{row.parentName || "최상위"}</td><td><span className={`badge ${row.item.status === "active" ? "badge-ok" : row.item.status === "deleted" ? "badge-danger" : "badge-warning"}`}>{row.item.status}</span></td><td>{overview.users.filter((user) => user.departmentId === row.item.id && user.status !== "deleted").length}</td></tr>)}{filteredDepartmentRows.length === 0 ? <tr><td colSpan={8}>조건에 맞는 부서가 없습니다.</td></tr> : null}</tbody></table></div></div>
            </div>
          </section>
        );      case "roles":
        return (
          <section className="panel ops-panel">
            <div className="ops-shell management-shell">
              <div className="panel-head ops-head"><div><h2>권한 관리</h2></div><div className="ops-head-actions"><span className="mini-stat">전체 {overview.roles.length}개</span><span className="mini-stat">조회 {filteredRoles.length}개</span><span className="mini-stat">선택 {selectedRoleIds.length}개</span></div></div>
              <div className="management-list-toolbar" role="toolbar" aria-label="권한 역할 목록 작업">
                <label className="compact-field"><span>역할 검색</span><input value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} placeholder="역할명 또는 권한 코드" /></label>
                <label className="compact-field"><span>상태</span><select value={roleStatusFilter} onChange={(event) => setRoleStatusFilter(event.target.value)}><option value="visible">활성/비활성</option><option value="active">active</option><option value="inactive">inactive</option><option value="deleted">deleted</option><option value="all">전체</option></select></label>
                <div className="actions compact-actions"><button type="button" onClick={() => openRoleDialog()} disabled={loading}>새 권한 역할</button><button type="button" className="secondary" onClick={() => requestBulkAction("roles", "active", selectedRoleIds)} disabled={loading || selectedRoleIds.length === 0}>활성화</button><button type="button" className="secondary" onClick={() => requestBulkAction("roles", "inactive", selectedRoleIds)} disabled={loading || selectedRoleIds.length === 0}>비활성화</button><button type="button" className="danger-action" onClick={() => requestBulkAction("roles", "delete", selectedRoleIds)} disabled={loading || selectedRoleIds.length === 0}>삭제</button></div>
              </div>
              {managementDialog === "role" && roleEditorOpen ? <div className="management-modal-backdrop" role="presentation" onClick={closeManagementDialog}><form className="management-modal management-role-modal" onSubmit={handleRoleCreate} onClick={(event) => event.stopPropagation()}><div className="management-modal-head"><div><strong>{roleEditingId ? "권한 역할 상세·편집" : "권한 역할 등록"}</strong><span className="muted">권한은 기능군별 선택으로만 관리합니다.</span></div><button type="button" className="secondary" onClick={closeManagementDialog}>닫기</button></div><div className="role-detail-meta">{roleEditingId ? <><span className="meta-chip">연결 사용자 {roleUserCounts.get(roleEditingId) ?? 0}명</span><span className="meta-chip">상태 {overview.roles.find((item) => item.id === roleEditingId)?.status ?? "-"}</span><span className="meta-chip">삭제 {(roleUserCounts.get(roleEditingId) ?? 0) > 0 ? "서버 차단 대상" : "가능 여부는 서버 재검증"}</span></> : <span className="meta-chip">새 사용자 정의 역할</span>}</div><div className="ops-toolbar-grid role-editor-toolbar-grid"><label className="compact-field"><span>역할명</span><input value={roleName} onChange={(event) => setRoleName(event.target.value)} /></label><div className="compact-field compact-field-wide"><span>선택 권한</span><div className="badge-row permission-preview-row">{selectedPermissionPreviewItems.length > 0 ? selectedPermissionPreviewItems.map((item) => <span key={item.code} className="meta-chip permission-preview-chip" title={item.code}><strong>{item.label}</strong><small>{item.code}</small></span>) : <span className="muted">선택된 권한 없음</span>}</div></div></div><div className="permission-group-grid">{permissionGroups.map((group) => { const groupCodes = group.options.map((option) => option.code); const selectedCount = groupCodes.filter((code) => normalizedRoleSelectedPermissions.includes(code)).length; return <article key={group.key} className="status-card permission-group-card"><div className="status-title"><strong>{group.label}</strong><span className="mini-stat">{selectedCount}/{groupCodes.length}</span></div><div className="row-actions"><button type="button" className="secondary" onClick={() => handleRoleGroupSelection(groupCodes, true)}>전체 선택</button><button type="button" className="secondary" onClick={() => handleRoleGroupSelection(groupCodes, false)} disabled={selectedCount === 0}>전체 해제</button></div><div className="stack-list">{group.options.map((option) => <label key={option.code} className="permission-check"><input type="checkbox" checked={normalizedRoleSelectedPermissions.includes(option.code)} onChange={(event) => handleRolePermissionToggle(option.code, event.target.checked)} /><span>{option.label}</span><small>{option.code}</small></label>)}</div></article>; })}</div><div className="actions compact-actions"><button type="submit" disabled={loading}>{roleEditingId ? "권한 수정 저장" : "권한 역할 등록"}</button></div></form></div> : null}
              <div className="ops-list-panel"><div className="ops-list-head"><strong>권한 역할 목록</strong><span className="muted">행을 더블클릭하면 권한 조회·편집 창이 열립니다.</span></div><div className="table-wrap ops-scroll role-list-scroll"><table className="data-table"><thead><tr><th><input type="checkbox" aria-label="현재 권한 역할 결과 전체 선택" checked={filteredRoles.length > 0 && filteredRoles.every((item) => selectedRoleIds.includes(item.id))} onChange={(event) => setSelectedRoleIds(event.target.checked ? filteredRoles.map((item) => item.id) : [])} /></th><th>역할명</th><th>상태</th><th>권한 수</th><th>연결 사용자</th><th>삭제 기준</th></tr></thead><tbody>{filteredRoles.map((item) => { const connectedUserCount = roleUserCounts.get(item.id) ?? 0; const isDefaultRole = ["관리자", "일반사용자"].includes(item.name); return <tr key={item.id} onDoubleClick={() => openRoleDialog(item)} className="management-list-row"><td><input type="checkbox" aria-label={`${item.name} 선택`} checked={selectedRoleIds.includes(item.id)} onChange={(event) => toggleSelection(selectedRoleIds, item.id, event.target.checked, setSelectedRoleIds)} onClick={(event) => event.stopPropagation()} /></td><td>{item.name}</td><td><span className={`badge ${item.status === "active" ? "badge-ok" : item.status === "deleted" ? "badge-danger" : "badge-warning"}`}>{item.status}</span></td><td>{item.permissions.length}</td><td>{connectedUserCount}</td><td>{item.status === "deleted" ? "삭제됨" : isDefaultRole ? "기본 역할" : connectedUserCount > 0 ? "연결 사용자 있음" : "삭제 가능"}</td></tr>; })}{filteredRoles.length === 0 ? <tr><td colSpan={6}>조건에 맞는 권한 역할이 없습니다.</td></tr> : null}</tbody></table></div></div>
            </div>
          </section>
        );      case "service":
        return <section className="panel ops-panel"><div className="ops-shell"><div className="panel-head ops-head"><h2>서비스 운영</h2><div className="actions compact-actions"><button type="button" onClick={() => setOperationsDialog("domain")}>도메인 검증 실행</button><button type="button" className="secondary" onClick={() => setOperationsDialog("relay")}>Relay 테스트 실행</button></div></div><div className="overview-grid"><article className="status-card"><strong>운영 점검</strong><span className="mini-stat">열린 경고 {monitoringOverview?.alertOpenCount ?? 0}건</span></article><article className="status-card"><strong>Relay 상태</strong><span className="mini-stat">{relayResult?.status ?? "최근 실행 없음"}</span></article></div><div className="ops-list-panel"><div className="ops-list-head"><strong>도메인 검증 이력</strong><span className="muted">행을 더블클릭하면 실행 결과를 확인합니다.</span></div><div className="table-wrap ops-scroll"><table className="data-table"><thead><tr><th>유형</th><th>대상</th><th>상태</th><th>결과</th></tr></thead><tbody>{(domainResult?.checks ?? []).map((item) => <tr key={`${item.recordType}-${item.host}`} onDoubleClick={() => { setOperationDetail({ title: "도메인 검증 상세", lines: [item.recordType, item.host, item.code, item.message, item.status] }); setOperationsDialog("audit"); }}><td>{item.recordType}</td><td>{item.host}</td><td>{item.status}</td><td>[{item.code}] {item.message}</td></tr>)}{!domainResult ? <tr><td colSpan={4}>검증 이력이 없습니다.</td></tr> : null}</tbody></table></div></div></div></section>;
      case "mail":
        return (
          <section className="panel ops-panel">
            <div className="ops-shell">
              <div className="panel-head ops-head">
                <div><h2>메일 설정</h2><p className="muted">도메인, 관리자 접근, 자체/OCI 발신 경로를 화면에서 운영합니다.</p></div>
                <div className="actions compact-actions">
                  <button type="button" onClick={() => setOperationsDialog("mailTest")}>활성 Provider 연결 테스트</button>
                  <button type="button" className="secondary" onClick={() => setOperationsDialog("provider")}>도메인·Provider 설정</button>
                  <button type="button" className="secondary" onClick={() => void refreshMailDelivery()}>새로고침</button>
                </div>
              </div>
              <div className="overview-grid">
                <article className="status-card"><strong>활성 Provider</strong><span className="mini-stat">{mailOperations?.domain?.activeOutboundProvider ?? mailDeliveryStatus?.provider.providerKey ?? "미설정"}</span></article>
                <article className="status-card"><strong>관리자 접근</strong><span className="mini-stat">{mailOperations?.domain?.adminAccessMode ?? "미설정"}</span></article>
                <article className="status-card"><strong>외부 메일 도메인</strong><span className="mini-stat">{mailOperations?.domain?.mailDomain ?? "미설정"}</span></article>
                <article className="status-card"><strong>반송 / OCI suppression</strong><span className="mini-stat">{mailOperations?.feedbackCount ?? 0} / {mailOperations?.ociSuppression.activeCount ?? 0}</span></article>
              </div>
              <div className="actions compact-actions">
                <button type="button" disabled={loading || mailOperations?.domain?.activeOutboundProvider === "self_hosted"} onClick={() => void handleMailProviderSwitch("self_hosted")}>자체 엔진으로 전환</button>
                <button type="button" disabled={loading || mailOperations?.domain?.activeOutboundProvider === "oci_email_delivery"} onClick={() => void handleMailProviderSwitch("oci_email_delivery")}>OCI로 전환</button>
                <button type="button" className="secondary" disabled={loading || !mailOperations?.domain?.previousOutboundProvider} onClick={() => void handleMailProviderRollback()}>직전 Provider로 rollback</button>
                <button type="button" className="secondary" disabled={loading} onClick={() => void handleOciSuppressionSync()}>OCI suppression 동기화</button>
              </div>
              <div className="ops-list-panel">
                <div className="ops-list-head"><strong>Provider 상태</strong><span className="muted">비밀값은 화면과 API 응답에 노출하지 않습니다.</span></div>
                <div className="table-wrap"><table className="data-table"><thead><tr><th>Provider</th><th>활성</th><th>발송 잠금</th><th>연결 검증</th><th>DKIM</th></tr></thead><tbody>{(mailOperations?.providers ?? []).map((provider) => <tr key={provider.providerId}><td>{provider.providerKey}</td><td>{provider.active ? "활성" : "대기"}</td><td>{provider.deliveryEnabled ? "해제" : "잠김"}</td><td>{provider.lastTestStatus}</td><td>{provider.dkimPrivateKeyConfigured ? `${provider.dkimSelector ?? "-"} 설정` : "미설정"}</td></tr>)}{(mailOperations?.providers.length ?? 0) === 0 ? <tr><td colSpan={5}>Provider 설정이 없습니다.</td></tr> : null}</tbody></table></div>
              </div>
              <div className="ops-list-panel"><div className="ops-list-head"><strong>최근 전달 이력</strong></div><div className="table-wrap ops-scroll"><table className="data-table"><thead><tr><th>수신자</th><th>제목</th><th>상태</th><th>재시도</th></tr></thead><tbody>{(mailDeliveryQueue?.queue ?? []).map((item) => <tr key={item.queueId} onDoubleClick={() => { setOperationDetail({ title: "전달 상세", lines: [item.recipient, item.subject, item.status, `재시도 ${item.attemptCount}`, item.lastError ?? "오류 없음"] }); setOperationsDialog("audit"); }}><td>{item.recipient}</td><td>{item.subject}</td><td>{item.status}</td><td>{item.attemptCount}</td></tr>)}{(mailDeliveryQueue?.queue?.length ?? 0) === 0 ? <tr><td colSpan={4}>전달 이력이 없습니다.</td></tr> : null}</tbody></table></div></div>
            </div>
          </section>
        );
      case "messenger":
        return (
          <section className="panel ops-panel">
            <div className="ops-shell">
              <div className="panel-head ops-head">
                <div><h2>메신저 대화방 관리</h2><p className="muted">활성 대화방과 삭제 보존 상태를 확인합니다.</p></div>
                <div className="actions compact-actions">
                  <label className="compact-field"><span>상태</span><select value={adminMessengerStatus} onChange={(event) => { const next = event.target.value as "active" | "deleted" | "all"; setAdminMessengerStatus(next); void refreshAdminMessengerRooms(token, next); }}><option value="all">전체</option><option value="active">활성</option><option value="deleted">삭제 보존</option></select></label>
                  <button type="button" className="secondary" onClick={() => void refreshAdminMessengerRooms()} disabled={loading}>새로고침</button>
                </div>
              </div>
              <div className="overview-grid">
                <article className="status-card"><strong>조회 대화방</strong><span className="mini-stat">{adminMessengerRooms.length}개</span></article>
                <article className="status-card"><strong>보존 정책</strong><span className="mini-stat">삭제 후 14일</span></article>
              </div>
              <div className="ops-list-panel">
                <div className="ops-list-head"><strong>대화방 목록</strong><span className="muted">삭제하면 즉시 숨김 처리되고 대화·첨부는 14일 후 자동 정리됩니다.</span></div>
                <div className="table-wrap ops-scroll"><table className="data-table"><thead><tr><th>대화방</th><th>방장</th><th>상태</th><th>참여자</th><th>메시지</th><th>갱신일</th><th>보존 만료</th><th>작업</th></tr></thead><tbody>
                  {adminMessengerRooms.map((room) => <tr key={room.roomId}><td>{room.roomName}</td><td>{room.ownerUserName}</td><td><span className={`badge ${room.status === "active" ? "badge-ok" : "badge-warning"}`}>{room.status}</span></td><td>{room.participantCount}</td><td>{room.messageCount}</td><td>{new Date(room.updatedAt).toLocaleString("ko-KR")}</td><td>{room.retentionExpiresAt ? new Date(room.retentionExpiresAt).toLocaleString("ko-KR") : "-"}</td><td><button type="button" className="danger-action" disabled={loading || room.status !== "active"} onClick={() => setMessengerDeleteTarget(room)}>삭제</button></td></tr>)}
                  {adminMessengerRooms.length === 0 ? <tr><td colSpan={8}>표시할 대화방이 없습니다.</td></tr> : null}
                </tbody></table></div>
              </div>
            </div>
          </section>
        );
      case "storage":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>저장소/DB 상태</h2>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>저장소 상태</strong>
                <p>{health?.components.storage?.status ?? "unknown"}</p>

              </article>
              <article className="status-card">
                <strong>DB 상태</strong>
                <p>{health?.components.db?.status ?? "unknown"}</p>

              </article>
              <article className="status-card">
                <strong>백업/복구 요약</strong>
                <p>{health?.components.storage?.details?.backup_status || "요약 미수집"}</p>

              </article>
            </div>
          </section>
        );
      case "approval":
        return (
          <section className="panel ops-panel">
            <div className="ops-shell">
              <div className="panel-head ops-head">
                <div>
                  <h2>{copy.approvalAuditTitle}</h2>
                </div>
                <div className="ops-head-actions">
                  <span className="mini-stat">전체 {approvalAuditLogs.length}건</span>
                  <span className="mini-stat">표시 {filteredApprovalAuditLogs.length}건</span>
                </div>
              </div>
              <div className="ops-toolbar">
                <div className="ops-toolbar-grid approval-toolbar-grid">
                  <label className="compact-field compact-field-wide">
                    <span>로그 필터 <InlineHint label="이벤트, 문서 ID, 처리자, 상태 전이, 사유 기준으로 현재 목록을 즉시 좁힙니다." /></span>
                    <input value={approvalSearch} onChange={(event) => setApprovalSearch(event.target.value)} placeholder="이벤트, 문서 ID, 처리자, 상태 전이" />
                  </label>
                </div>
                <div className="actions compact-actions">
                  <button type="button" className="secondary" onClick={() => void refreshApprovalAuditLogs()}>
                    {copy.refreshApprovalLogs}
                  </button>
                </div>
              </div>
              <div className="ops-list-panel">
                <div className="ops-list-head">
                  <strong>감사 로그 목록</strong>
                </div>
                <div className="table-wrap ops-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>시각</th>
                        <th>이벤트</th>
                        <th>문서</th>
                        <th>처리자</th>
                        <th>상태 전이</th>
                        <th>사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredApprovalAuditLogs.slice(0, 200).map((item) => (
                        <tr key={item.id}>
                          <td>{new Date(item.createdAt).toLocaleString()}</td>
                          <td>{item.event}</td>
                          <td>{item.targetId}</td>
                          <td>{item.actorUserName}</td>
                          <td>{`${item.statusBefore ?? "-"} -> ${item.statusAfter ?? "-"}`}</td>
                          <td>{item.reason ?? "-"}</td>
                        </tr>
                      ))}
                      {filteredApprovalAuditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={6}>{approvalSearch ? "조건에 맞는 결재 감사 로그가 없습니다." : "결재 감사 로그가 없습니다."}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        );
      case "brand":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>브랜드/화면 설정</h2>
              </div>
            </div>
            <div className="ops-head-actions" style={{ marginBottom: 16 }}>
              <span className="mini-stat">회사 {uiContractDraft.company.name}</span>
              <span className="mini-stat">도메인 {uiContractDraft.company.domain}</span>
              <span className="mini-stat">메뉴 {uiContractDraft.menuOrder.join(" · ")}</span>
            </div>
            <div className="split-panel">
              <article>
                <h3>회사 식별 정보</h3>
                <div className="brand-identity-card">
                  <div className="brand-identity-grid">
                    <label>
                      회사명
                      <input value={uiContractDraft.company.name} readOnly />
                    </label>
                    <label>
                      도메인
                      <input value={uiContractDraft.company.domain} readOnly />
                    </label>
                  </div>
                  <div className="logo-editor-row">
                    <div className="company-logo-shell">
                      <img src={uiContractDraft.company.logoDataUrl} alt={`${uiContractDraft.company.name} 로고`} className="company-logo-image" />
                    </div>
                    <div className="logo-editor-actions">
                      <div className="logo-editor-title">
                        회사 로고 <InlineHint label="업로드한 로고는 저장 후 관리자 웹과 사용자 웹 헤더에 공통 반영됩니다." />
                      </div>
                      <input type="file" accept="image/*" onChange={(event) => void handleCompanyLogoUpload(event)} />
                      <div className="actions">
                        <button type="button" className="secondary" onClick={restoreDefaultCompanyLogo}>기본 로고 복구</button>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 style={{ marginTop: 18 }}>설정</h3>
                <form className="wizard" onSubmit={(event) => event.preventDefault()}>
                  <div className="field-grid">
                    {[
                      { key: "primary", label: "대표 색상", helper: "주요 버튼과 활성 상태" },
                      { key: "secondary", label: "보조 색상", helper: "헤더와 보조 카드" },
                      { key: "accent", label: "강조 색상", helper: "배지와 보조 강조 포인트" },
                      { key: "blocked", label: "차단 색상", helper: "차단/경고 상태" },
                    ].map((item) => {
                      const colorKey = item.key as keyof UiContract["brand"];
                      const fallbackColor = defaultUiContract.brand[colorKey];
                      const colorValue = uiContractDraft.brand[colorKey];
                      const normalizedColor = normalizeHexColor(colorValue, fallbackColor);
                      return (
                        <label key={item.key} className="color-setting-card">
                          <span>{item.label}</span>
                          <div className="color-control-row">
                            <input
                              type="color"
                              value={normalizedColor}
                              onChange={(e) =>
                                setUiContractDraft((current) => ({
                                  ...current,
                                  brand: {
                                    ...current.brand,
                                    [colorKey]: e.target.value,
                                  },
                                  company: {
                                    ...current.company,
                                    logoDataUrl: current.company.logoDataUrl.startsWith("data:image/svg+xml")
                                      ? buildDefaultCompanyLogo(current.company.name, colorKey === "primary" ? e.target.value : current.brand.primary, colorKey === "secondary" ? e.target.value : current.brand.secondary)
                                      : current.company.logoDataUrl,
                                  },
                                }))
                              }
                            />
                            <input
                              value={colorValue}
                              onChange={(e) =>
                                setUiContractDraft((current) => ({
                                  ...current,
                                  brand: {
                                    ...current.brand,
                                    [colorKey]: e.target.value,
                                  },
                                }))
                              }
                              onBlur={(e) => {
                                const nextColor = normalizeHexColor(e.target.value, fallbackColor);
                                setUiContractDraft((current) => ({
                                  ...current,
                                  brand: {
                                    ...current.brand,
                                    [colorKey]: nextColor,
                                  },
                                  company: {
                                    ...current.company,
                                    logoDataUrl: current.company.logoDataUrl.startsWith("data:image/svg+xml")
                                      ? buildDefaultCompanyLogo(current.company.name, colorKey === "primary" ? nextColor : current.brand.primary, colorKey === "secondary" ? nextColor : current.brand.secondary)
                                      : current.company.logoDataUrl,
                                  },
                                }));
                              }}
                            />
                            <span className="color-swatch" style={{ background: normalizedColor }} />
                          </div>
                          <InlineHint label={item.helper} />
                        </label>
                      );
                    })}
                    <label>
                      좌측 메뉴 순서
                      <input value={uiContractDraft.menuOrder.join(", ")} onChange={(e) => setUiContractDraft((current) => ({ ...current, menuOrder: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
                    </label>
                    <label>
                      홈 카드 우선순위
                      <input value={uiContractDraft.homeCardOrder.join(", ")} onChange={(e) => setUiContractDraft((current) => ({ ...current, homeCardOrder: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
                    </label>
                    <label>
                      Help / 정책 안내 문구
                      <input value={uiContractDraft.helpText} onChange={(e) => setUiContractDraft((current) => ({ ...current, helpText: e.target.value }))} />
                    </label>
                  </div>
                  <div className="actions">
                    <button type="button" onClick={handleUiContractSave}>설정 저장</button>
                    <button type="button" className="secondary" onClick={() => void reloadUiContract()}>저장값 다시 불러오기</button>
                  </div>
                </form>
              </article>
              <article>
                <h3>미리보기</h3>
                <div className="brand-preview-grid">
                  <article className="brand-preview-card">
                    <div className="brand-preview-header" style={{ background: normalizeHexColor(uiContractDraft.brand.secondary, defaultUiContract.brand.secondary), color: "#ffffff" }}>
                      운영 헤더 미리보기
                    </div>
                    <div className="brand-preview-body">
                      <div className="company-identity-block preview-identity">
                        <div className="company-logo-shell preview-logo-shell">
                          <img src={uiContractDraft.company.logoDataUrl} alt={`${uiContractDraft.company.name} 로고`} className="company-logo-image" />
                        </div>
                        <div>
                          <strong>{uiContractDraft.company.name}</strong>
                          <p className="muted">{uiContractDraft.company.domain}</p>
                        </div>
                      </div>
                      <button type="button" style={{ background: normalizeHexColor(uiContractDraft.brand.primary, defaultUiContract.brand.primary) }}>
                        주요 버튼
                      </button>
                      <button type="button" className="secondary">보조 버튼</button>
                      <span className="badge" style={{ background: normalizeHexColor(uiContractDraft.brand.accent, defaultUiContract.brand.accent), color: "#ffffff" }}>
                        강조 배지
                      </span>
                      <span className="badge" style={{ background: normalizeHexColor(uiContractDraft.brand.blocked, defaultUiContract.brand.blocked), color: "#ffffff" }}>
                        차단 상태
                      </span>
                    </div>
                  </article>
                  <article className="brand-preview-card">
                    <div className="brand-preview-body">
                      <div className="brand-preview-panel" style={{ borderColor: normalizeHexColor(uiContractDraft.brand.primary, defaultUiContract.brand.primary) }}>
                        <strong>{uiContractDraft.company.name} 로고/색상 공통 반영</strong>
                      </div>
                    </div>
                  </article>
                </div>
              </article>
            </div>
          </section>
        );
      case "language":
        return renderContentMessagesPanel();
      case "help":
        return renderHelpPoliciesPanel();
      default:
        return null;
    }
  };

  return (
    <main className={`shell ${showAdminConsole ? "console-shell" : ""} ${showLoginPanel ? "login-shell" : ""}`}>
        <section className="hero" hidden={showAdminConsole || showLoginPanel || showSetupWizard || isHealthPending}>
        <p className="eyebrow">{t(locale, "appTitle")}</p>
        <h1>{t(locale, "appDescription")}</h1>
        <p className="lead">운영 콘솔은 사용자 관리 및 서비스 점검을 위한 단일 진입 화면입니다.</p>
      </section>

      <section className="panel" hidden={!token || showAdminConsole || !initialized || !translationUiVisible}>
        <div className="panel-head">
          <div>
            <h2>시스템 상태 요약</h2>
            <p className="muted">로그인 화면 진입 후 필요한 설정은 설정 메뉴에서 관리합니다.</p>
          </div>
        </div>
        <article className="status-card">
          <strong>{t(locale, "translationPolicy")}</strong>
          <p>
            Provider: {translationStatus?.provider ?? "unknown"} / {translationStatus?.enabled ? t(locale, "success") : t(locale, "translationOff")}
          </p>
          <p className="muted">
            사용 가능: {translationStatus?.available ? t(locale, "success") : t(locale, "error")}
            {translationStatus?.fallbackMessage ? ` / ${translationStatus.fallbackMessage}` : ""}
          </p>
          <p className="muted">
            캐시: {translationStatus?.cacheEnabled ? t(locale, "success") : t(locale, "error")} / 정책: {translationPolicy ? "동기화" : "동기화 전"}
          </p>
        </article>
        {token ? (
          <div className="actions" style={{ marginTop: "12px" }}>
            <button type="button" onClick={() => void refreshTranslationState(token)}>{t(locale, "refresh")}</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void (translationStatus?.enabled ? toggleTranslationPolicy(false) : toggleTranslationPolicy(true));
              }}
            >
              번역 정책 {translationStatus?.enabled ? t(locale, "manual") : t(locale, "translationPolicy")}
            </button>
          </div>
        ) : null}
        {translationError ? <p className="muted" style={{ color: "crimson" }}>{translationError}</p> : null}
        <form className="compact-form" onSubmit={runTranslationDemo} style={{ marginTop: "12px" }}>
          <label>
            {t(locale, "sourceText")}
            <textarea value={translationSource} onChange={(event) => setTranslationSource(event.target.value)} />
          </label>
          <label>
            {t(locale, "targetLocale")}
            <select value={translationTargetLocale} onChange={(event) => setTranslationTargetLocale(event.target.value)}>
              {supportedTranslationTargets.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button type="submit" disabled={!token || translationLoading}>
              {translationLoading ? t(locale, "retry") : t(locale, "translate")}
            </button>
          </div>
        </form>
        <div style={{ marginTop: "12px" }}>
          <strong>{t(locale, "translationResult")}</strong>
          {translationResult.map((item, index) => (
            <article key={`${item.originalText}-${index}`} className="status-card">
              <p>
                {item.sourceLocale} → {item.targetLocale}
              </p>
              <p className="muted">{item.originalText}</p>
              <p>{item.translatedText}</p>
              {item.statusMessage ? <p className="muted">({item.statusMessage})</p> : null}
            </article>
          ))}
          {translationResult.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
        </div>
      </section>

      {showLoginPanel && (
        <section className="login-landing">
          <article className="login-brief">
            <div className="company-identity-block">
              <div className="company-logo-shell sidebar-logo-shell">
                <img src={uiContractDraft.company.logoDataUrl} alt={`${uiContractDraft.company.name} 로고`} className="company-logo-image" />
              </div>
              <div>
                <p className="eyebrow">{t(locale, "appTitle")}</p>
                <h1>{uiContractDraft.company.name} 관리자 플랫폼</h1>
              </div>
            </div>
            <p className="lead">시스템 상태를 확인하고 관리자 계정으로 운영 콘솔에 진입합니다.</p>
            <div className="login-summary-grid">
              <div className="status-card">
                <strong>서비스 상태</strong>
                <span className={`badge badge-${health?.status ?? "warning"}`}>전체 상태: {health?.status ?? "확인 중"}</span>
              </div>
                <div className="status-card">
                  <strong>초기 설정</strong>
                  <span className={`badge ${initialized ? "badge-ok" : "badge-warning"}`}>
                    {initialized ? "완료" : "미완료"}
                  </span>
                </div>
              </div>
            <details className="login-details">
              <summary>상세 상태 보기</summary>
              {!health ? (
                <p>상태를 불러오는 중입니다.</p>
              ) : (
                <div className="status-grid">
                  {Object.entries(health.components).map(([name, component]) => (
                    <article key={name} className="status-card">
                      <div className="status-title">
                        <strong>{name}</strong>
                        <span className={`badge badge-${component.status}`}>{component.status}</span>
                      </div>
                      <p>{component.message}</p>
                    </article>
                  ))}
                </div>
              )}
            </details>
          </article>

          <article className="login-card">
            <div className="panel-head">
              <div>
                <h2>관리자 로그인</h2>
                <p className="muted">로그인 후 사용자 관리와 서비스 점검 메뉴를 사용할 수 있습니다.</p>
              </div>
            </div>
            {hasStoredSessionButNoOverview && (
              <div className="notice warning">
                저장된 관리자 세션을 확인하지 못했습니다. 다시 로그인해 운영 화면을 복구하세요.
              </div>
            )}
            {publicUiContractState === "error" && (
              <div className="notice danger">
                <strong>로그인 도메인 확인 실패</strong>
                <p>{publicUiContractError}</p>
              </div>
            )}
            {uniqueErrors.length > 0 && (
              <div className="notice danger">
                <strong>확인 필요</strong>
                <ul>{uniqueErrors.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {visibleWarnings.length > 0 && (
              <div className="notice warning">
                <strong>확인 필요</strong>
                <ul>{visibleWarnings.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <form className="compact-form" onSubmit={handleLogin}>
              <label>
                {copy.adminEmail}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
                  <input value={loginForm.loginId} onChange={(e) => setLoginForm({ ...loginForm, loginId: normalizeLoginIdInput(e.target.value) })} placeholder="admin" />
                  <span style={{ height: 40, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 12, border: "1px solid #dbe4ec", background: "#f8fafc", color: "#475569", fontSize: 13, fontWeight: 700 }}>@{publicUiContractState === "ready" ? uiContractDraft.company.domain : "도메인 확인 필요"}</span>
                </div>
              </label>
              <label>
                {copy.adminPassword}
                <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
              </label>
              <button type="submit" disabled={loading || publicUiContractState !== "ready"}>로그인</button>
            </form>
          </article>
        </section>
      )}

      <section className="panel" hidden={showAdminConsole || showLoginPanel || showSetupWizard || isHealthPending}>
        <div className="panel-head">
          <h2>시스템 상태</h2>
          <button onClick={() => void refreshHealth()}>새로고침</button>
        </div>
        {!health ? (
          <p>상태를 불러오는 중입니다.</p>
        ) : (
          <>
            <div className="badge-row">
              <span className={`badge badge-${health.status}`}>전체 상태: {health.status}</span>
              <span className={`badge ${initialized ? "badge-ok" : "badge-warning"}`}>
                초기 설정: {initialized ? "완료" : "미완료"}
              </span>
            </div>
            <div className="status-grid">
              {Object.entries(health.components).map(([name, component]) => (
                <article key={name} className="status-card">
                  <div className="status-title">
                    <strong>{name}</strong>
                    <span className={`badge badge-${component.status}`}>{component.status}</span>
                  </div>
                  <p>{component.message}</p>
                  {Object.keys(component.details).length > 0 && (
                    <ul>
                      {Object.entries(component.details).map(([key, value]) => (
                        <li key={key}>
                          {key}: {value}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {(message || uniqueErrors.length > 0 || visibleWarnings.length > 0) && !showAdminConsole && !showLoginPanel && !showSetupWizard && !isHealthPending && (
        <section className="panel">
          {message && <p className="result">{message}</p>}
          {uniqueErrors.length > 0 && (
            <div className="notice danger">
              <strong>확인 필요</strong>
              <ul>{uniqueErrors.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {visibleWarnings.length > 0 && (
            <div className="notice warning">
              <strong>확인 필요</strong>
              <ul>{visibleWarnings.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {isHealthPending && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>시스템 상태 확인 중</h2>
              <p className="muted">초기 설치 여부를 확인하는 동안에는 설치 화면과 로그인 화면을 노출하지 않습니다.</p>
            </div>
          </div>
          <div className="notice warning">
            시스템 상태를 불러오는 중입니다. 잠시 후 초기 설치 또는 로그인 화면으로 전환됩니다.
          </div>
        </section>
      )}

      {showSetupWizard && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>초기 설정 Wizard</h2>
              <p className="muted">검증 통과 후에만 저장하도록 운영 흐름을 고정합니다.</p>
            </div>
          </div>

          <form className="wizard" onSubmit={handleValidate}>
            <div className="field-grid">
              <label>
                회사명
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
              </label>
              <label>
                도메인
                <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
              </label>
              <label>
                관리자 이름
                <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              </label>
              <label>
                관리자 이메일
                <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
              </label>
              <label>
                관리자 비밀번호
                <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
              </label>
              <label>
                Relay 유형
                <select value={form.relayType} onChange={(e) => setForm({ ...form, relayType: e.target.value })}>
                  <option value="smtp">SMTP</option>
                  <option value="aws_ses">AWS SES</option>
                  <option value="oci_email_delivery">OCI Email Delivery</option>
                </select>
              </label>
              <label>
                Relay 호스트
                <input value={form.relayHost} onChange={(e) => setForm({ ...form, relayHost: e.target.value })} />
              </label>
              <label>
                Relay 포트
                <input value={form.relayPort} onChange={(e) => setForm({ ...form, relayPort: e.target.value })} />
              </label>
              <label>
                Relay 사용자
                <input value={form.relayUsername} onChange={(e) => setForm({ ...form, relayUsername: e.target.value })} />
              </label>
              <label>
                Relay 비밀번호
                <input type="password" value={form.relayPassword} onChange={(e) => setForm({ ...form, relayPassword: e.target.value })} />
              </label>
              <label>
                DB 호스트
                <input value={form.dbHost} onChange={(e) => setForm({ ...form, dbHost: e.target.value })} />
              </label>
              <label>
                DB 포트
                <input value={form.dbPort} onChange={(e) => setForm({ ...form, dbPort: e.target.value })} />
              </label>
              <label>
                DB 이름
                <input value={form.dbName} onChange={(e) => setForm({ ...form, dbName: e.target.value })} />
              </label>
              <label>
                DB 사용자
                <input value={form.dbUser} onChange={(e) => setForm({ ...form, dbUser: e.target.value })} />
              </label>
              <label>
                DB 비밀번호
                <input type="password" value={form.dbPassword} onChange={(e) => setForm({ ...form, dbPassword: e.target.value })} />
              </label>
              <label>
                저장소 경로
                <input value={form.storagePath} onChange={(e) => setForm({ ...form, storagePath: e.target.value })} />
              </label>
            </div>

            <div className="actions">
              <button type="submit" disabled={loading}>
                검증 실행
              </button>
              <button type="button" className="secondary" disabled={loading} onClick={() => void handleInitialize()}>
                초기 설정 저장
              </button>
            </div>
          </form>
        </section>
      )}

      {initialized && token && overview && (
        <section className="console-layout">
          <aside className="console-sidebar">
            <div className="company-identity-block">
              <div className="company-logo-shell sidebar-logo-shell">
                <img src={uiContractDraft.company.logoDataUrl} alt={`${uiContractDraft.company.name} 로고`} className="company-logo-image" />
              </div>
              <div>
                <p className="eyebrow">MoaWorks Admin</p>
                <h2>{uiContractDraft.company.name}</h2>
                <p className="muted">{uiContractDraft.company.domain}</p>
              </div>
            </div>
            <nav className="console-menu" aria-label="관리자 메뉴">
              {adminMenus.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === activeAdminMenu ? "menu-item active" : "menu-item"}
                  onClick={() => navigateAdminMenu(item.key)}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="console-profile">
              <strong>관리자 세션</strong>
              <p className="muted">{loginForm.loginId || "관리자"}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  clearToken();
                  setToken("");
                  setTranslationPolicy(null);
                  setTranslationStatus(null);
                  setTranslationResult([]);
                  setOverview(null);
                  setMonitoringOverview(null);
                  setMonitoringEvents([]);
                  setApprovalAuditLogs([]);
                  setAlertPanelOpen(false);
                  setActiveAdminMenu("dashboard");
                }}
              >
                {t(locale, "logout")}
              </button>
            </div>
          </aside>

          <section className="console-main">
            <div className="console-topbar">
              <div>
                <p className="muted">관리자 콘솔 / {activeMenu.label}</p>
                <h2>{activeMenu.label}</h2>
              </div>
              <div className="topbar-actions">
                <input aria-label="빠른 이동" placeholder="메뉴 또는 작업 검색" readOnly value={activeMenu.label} />
                <div className="alert-panel-wrap">
                  <button
                    type="button"
                    className={`secondary alert-toggle ${alertPanelOpen ? "is-open" : ""}`}
                    onClick={() => setAlertPanelOpen((current) => !current)}
                  >
                    경고/알림 {alertSummaryCount > 0 ? `${alertSummaryCount}건` : "0건"}
                  </button>
                  {alertPanelOpen ? (
                    <div className="alert-panel" role="dialog" aria-label="경고 및 알림 요약">
                      <div className="alert-panel-head">
                        <strong>운영 알림 요약</strong>
                        <button type="button" className="secondary" onClick={() => setAlertPanelOpen(false)}>닫기</button>
                      </div>
                      <div className="alert-panel-body">
                        <div className="alert-panel-summary">
                          <span className="mini-stat">화면 알림 {alertItems.length}건</span>
                          <span className="mini-stat">열린 운영 경고 {monitoringOverview?.alertOpenCount ?? 0}건</span>
                        </div>
                        {alertItems.length > 0 ? (
                          <div className="alert-panel-list">
                            {alertItems.map((item, index) => (
                              <div key={`${item.level}-${index}`} className={`alert-item ${item.level}`}>
                                <strong>{item.level === "error" ? "오류" : item.level === "warning" ? "경고" : "성공"}</strong>
                                <p>{item.text}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="alert-item neutral">
                            <strong>현재 알림 없음</strong>
                            <p>메뉴 본문을 밀지 않도록 경고와 성공 메시지는 이 패널 안에서만 확인합니다.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {message ? (
              <div className="notice success console-toast" role="status" aria-live="polite">
                <strong>{message}</strong>
              </div>
            ) : null}
            {renderAdminPanel()}
            {contentDialog ? (
              <div className="management-modal-backdrop" role="presentation" onClick={() => !loading && setContentDialog(null)}>
                <section className="management-modal content-editor-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  {contentDialog.resource === "message" ? (
                    <form className="compact-form" onSubmit={saveContentMessage}>
                      <div className="management-modal-head"><div><strong>{contentDialog.mode === "create" ? "새 메시지" : "메시지 상세"}</strong>{contentDialog.item ? <span className="muted">상태 {contentDialog.item.status} · {contentDialog.item.is_system ? "시스템 항목" : "운영 항목"}</span> : null}</div><button type="button" className="secondary" onClick={() => setContentDialog(null)}>닫기</button></div>
                      {contentDialog.item?.is_system ? <div className="notice warning"><strong>시스템 항목 보호</strong><p>시스템 메시지는 조회만 가능하며 수정·상태 변경·삭제는 서버에서도 차단됩니다.</p></div> : null}
                      {contentDialog.item?.status === "deleted" ? <div className="notice warning"><strong>삭제 상태</strong><p>삭제된 메시지는 조회만 가능하며 다시 수정할 수 없습니다.</p></div> : null}
                      {contentDialogError ? <div className="notice warning"><strong>처리 실패</strong><p>{contentDialogError}</p></div> : null}
                      <fieldset className="ops-toolbar-grid content-editor-grid" disabled={loading || Boolean(contentDialog.item?.is_system) || contentDialog.item?.status === "deleted"}>
                        <label className="compact-field"><span>메시지 키</span><input value={contentMessageDraft.key} onChange={(event) => setContentMessageDraft((current) => ({ ...current, key: event.target.value }))} required /></label>
                        <label className="compact-field"><span>기본 언어</span><input value={contentMessageDraft.defaultLocale} onChange={(event) => setContentMessageDraft((current) => ({ ...current, defaultLocale: event.target.value }))} required /></label>
                        <label className="compact-field"><span>분류</span><input value={contentMessageDraft.category} onChange={(event) => setContentMessageDraft((current) => ({ ...current, category: event.target.value }))} required /></label>
                        <label className="compact-field"><span>번역 언어</span><input value={contentMessageDraft.locale} onChange={(event) => setContentMessageDraft((current) => ({ ...current, locale: event.target.value }))} required /></label>
                        <label className="compact-field content-editor-wide"><span>번역 내용</span><textarea value={contentMessageDraft.content} onChange={(event) => setContentMessageDraft((current) => ({ ...current, content: event.target.value }))} required /></label>
                      </fieldset>
                      <div className="actions compact-actions"><button type="submit" disabled={loading || Boolean(contentDialog.item?.is_system) || contentDialog.item?.status === "deleted"}>{contentDialog.mode === "create" ? "등록" : "수정 저장"}</button></div>
                    </form>
                  ) : (
                    <form className="compact-form" onSubmit={saveHelpPolicy}>
                      <div className="management-modal-head"><div><strong>{contentDialog.mode === "create" ? "새 정책" : "정책 상세"}</strong>{contentDialog.item ? <span className="muted">상태 {contentDialog.item.status} · 버전 {contentDialog.item.version} · {contentDialog.item.is_system ? "시스템 항목" : "운영 항목"}</span> : null}</div><button type="button" className="secondary" onClick={() => setContentDialog(null)}>닫기</button></div>
                      {contentDialog.item?.is_system ? <div className="notice warning"><strong>시스템 항목 보호</strong><p>시스템 정책은 조회만 가능하며 수정·상태 변경·삭제는 서버에서도 차단됩니다.</p></div> : null}
                      {contentDialog.item?.status === "deleted" ? <div className="notice warning"><strong>삭제 상태</strong><p>삭제된 정책은 조회만 가능하며 다시 수정할 수 없습니다.</p></div> : null}
                      {contentDialogError ? <div className="notice warning"><strong>처리 실패</strong><p>{contentDialogError}</p></div> : null}
                      <fieldset className="ops-toolbar-grid content-editor-grid" disabled={loading || Boolean(contentDialog.item?.is_system) || contentDialog.item?.status === "deleted"}>
                        <label className="compact-field"><span>정책 코드</span><input value={helpPolicyDraft.code} onChange={(event) => setHelpPolicyDraft((current) => ({ ...current, code: event.target.value }))} disabled={contentDialog.mode === "detail"} required /></label>
                        <label className="compact-field"><span>제목</span><input value={helpPolicyDraft.title} onChange={(event) => setHelpPolicyDraft((current) => ({ ...current, title: event.target.value }))} required /></label>
                        <label className="compact-field"><span>분류</span><input value={helpPolicyDraft.category} onChange={(event) => setHelpPolicyDraft((current) => ({ ...current, category: event.target.value }))} required /></label>
                        <label className="compact-field"><span>대상</span><select value={helpPolicyDraft.audience} onChange={(event) => setHelpPolicyDraft((current) => ({ ...current, audience: event.target.value }))}><option value="all">all</option><option value="admin">admin</option><option value="user">user</option></select></label>
                        <label className="compact-field content-editor-wide"><span>본문</span><textarea value={helpPolicyDraft.content} onChange={(event) => setHelpPolicyDraft((current) => ({ ...current, content: event.target.value }))} required /></label>
                      </fieldset>
                      <div className="actions compact-actions"><button type="submit" disabled={loading || Boolean(contentDialog.item?.is_system) || contentDialog.item?.status === "deleted"}>{contentDialog.mode === "create" ? "등록" : "수정 저장"}</button></div>
                    </form>
                  )}
                </section>
              </div>
            ) : null}
            {contentBulkDialog ? (
              <div className="management-modal-backdrop" role="presentation" onClick={() => !loading && setContentBulkDialog(null)}>
                <section className="management-modal management-confirm-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  <div className="management-modal-head"><strong>{contentBulkDialog.action === "delete" ? "삭제 상태 전환 확인" : "일괄 상태 변경 확인"}</strong><button type="button" className="secondary" onClick={() => setContentBulkDialog(null)} disabled={loading}>닫기</button></div>
                  <p>{contentBulkDialog.resource === "message" ? "메시지" : "정책"} {contentBulkDialog.ids.length}건을 {contentBulkDialog.action === "delete" ? "deleted 상태로 전환" : contentBulkDialog.action === "published" ? "발행" : contentBulkDialog.action === "active" ? "활성화" : "비활성화"}합니다.</p>
                  <p className="muted">시스템 항목과 삭제된 항목은 서버에서 다시 검증하며 변경할 수 없습니다.</p>
                  {contentDialogError ? <div className="notice warning"><strong>작업 차단</strong><p>{contentDialogError}</p></div> : null}
                  <div className="actions compact-actions"><button type="button" className={contentBulkDialog.action === "delete" ? "danger-action" : ""} onClick={() => void executeContentBulkAction()} disabled={loading}>확인</button><button type="button" className="secondary" onClick={() => setContentBulkDialog(null)} disabled={loading}>취소</button></div>
                </section>
              </div>
            ) : null}
            {messengerDeleteTarget ? (
              <div className="management-modal-backdrop" role="presentation" onClick={() => !loading && setMessengerDeleteTarget(null)}>
                <section className="management-modal management-confirm-modal" role="alertdialog" aria-modal="true" aria-label="대화방 삭제 확인" onClick={(event) => event.stopPropagation()}>
                  <div className="management-modal-head"><strong>대화방 삭제 확인</strong><button type="button" className="secondary" onClick={() => setMessengerDeleteTarget(null)} disabled={loading}>닫기</button></div>
                  <p><strong>{messengerDeleteTarget.roomName}</strong> 대화방을 삭제 상태로 전환합니다.</p>
                  <p className="muted">사용자 화면에서는 즉시 숨겨지고 대화·첨부는 14일 후 자동 정리됩니다. 감사 이력은 보존됩니다.</p>
                  <div className="actions compact-actions"><button type="button" className="danger-action" onClick={() => void confirmDeleteAdminMessengerRoom()} disabled={loading}>삭제</button><button type="button" className="secondary" onClick={() => setMessengerDeleteTarget(null)} disabled={loading}>취소</button></div>
                </section>
              </div>
            ) : null}
            {operationsDialog ? (
              <div className="management-modal-backdrop" role="presentation" onClick={() => !loading && setOperationsDialog(null)}>
                <section className="management-modal operations-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  <div className="management-modal-head"><strong>{operationsDialog === "domain" ? "도메인 검증 실행" : operationsDialog === "relay" ? "Relay 테스트 실행" : operationsDialog === "mailTest" ? "제공자 연결 테스트" : operationsDialog === "provider" ? "메일 제공자 설정" : operationsDialog === "storage" ? "운영 점검 실행" : operationsDialog === "brand" ? "브랜드/화면 설정 편집" : operationsDialog === "language" ? "다국어/메시지 설정" : operationsDialog === "help" ? "도움말/정책 상세" : "감사 로그 상세"}</strong><button type="button" className="secondary" onClick={() => setOperationsDialog(null)}>닫기</button></div>
                  {operationsDialog === "domain" ? <form className="compact-form" onSubmit={(event) => { void handleDomainVerify(event); setOperationsDialog(null); }}><label>검증 도메인<input value={domainInput} onChange={(event) => setDomainInput(event.target.value)} /></label><button type="submit" disabled={loading}>검증 실행</button></form> : null}
                  {operationsDialog === "relay" ? <form className="compact-form" onSubmit={(event) => { void handleRelayTest(event); setOperationsDialog(null); }}><label>테스트 수신자<input type="email" value={relayRecipient} onChange={(event) => setRelayRecipient(event.target.value)} /></label><button type="submit" disabled={loading}>Relay 테스트</button></form> : null}
                  {operationsDialog === "mailTest" ? <form className="compact-form" onSubmit={(event) => { void handleMailDeliveryTest(event); setOperationsDialog(null); }}><label>테스트 Provider<select value={mailProviderOperationsForm.providerKey} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, providerKey: event.target.value as MailProviderOperationsForm["providerKey"] }))}><option value="self_hosted">자체 메일 엔진</option><option value="oci_email_delivery">OCI Email Delivery</option></select></label><label>실제 외부 수신자<input type="email" required value={relayRecipient} onChange={(event) => setRelayRecipient(event.target.value)} /></label><button type="submit" disabled={loading}>실제 외부 SMTP 테스트</button></form> : null}
                  {operationsDialog === "provider" ? (
                    <div className="stack-list">
                      <form className="compact-form" onSubmit={(event) => void handleMailDomainOperationsSave(event)}>
                        <strong>도메인·관리자 접근 정책</strong>
                        <label>등록 도메인<input value={mailDomainOperationsForm.registeredDomain} onChange={(event) => setMailDomainOperationsForm((current) => ({ ...current, registeredDomain: event.target.value }))} required /></label>
                        <label>외부 메일 도메인<input value={mailDomainOperationsForm.mailDomain} onChange={(event) => setMailDomainOperationsForm((current) => ({ ...current, mailDomain: event.target.value }))} required /></label>
                        <label>관리자 접근 모드<select value={mailDomainOperationsForm.adminAccessMode} onChange={(event) => setMailDomainOperationsForm((current) => ({ ...current, adminAccessMode: event.target.value as MailDomainOperationsForm["adminAccessMode"] }))}><option value="public">public - 외부 공개</option><option value="restricted">restricted - 허용 IP/CIDR만</option><option value="private">private - 사설망/VPN만</option></select></label>
                        <label>허용 IP/CIDR<textarea value={mailDomainOperationsForm.adminAllowedCidrs} onChange={(event) => setMailDomainOperationsForm((current) => ({ ...current, adminAllowedCidrs: event.target.value }))} placeholder="203.0.113.0/24&#10;2001:db8::/64" /></label>
                        <button type="submit" disabled={loading}>도메인·접근 정책 저장</button>
                      </form>
                      <form className="compact-form" onSubmit={(event) => void handleMailProviderOperationsSave(event)}>
                        <strong>발신 Provider 설정</strong>
                        <label>Provider<select value={mailProviderOperationsForm.providerKey} onChange={(event) => {
                          const providerKey = event.target.value as MailProviderOperationsForm["providerKey"];
                          const provider = mailOperations?.providers.find((item) => item.providerKey === providerKey);
                          setMailProviderOperationsForm((current) => ({ ...current, providerKey, relayHost: provider?.relayHost ?? "", relayPort: String(provider?.relayPort ?? (providerKey === "oci_email_delivery" ? 587 : 25)), tlsMode: provider?.tlsMode ?? (providerKey === "oci_email_delivery" ? "starttls" : "none"), senderAddress: provider?.senderAddress ?? "", username: "", password: "", dkimDomain: provider?.dkimDomain ?? "", dkimSelector: provider?.dkimSelector ?? "", dkimPrivateKey: "" }));
                        }}><option value="self_hosted">자체 메일 엔진</option><option value="oci_email_delivery">OCI Email Delivery</option></select></label>
                        <label>SMTP/MX 호스트<input value={mailProviderOperationsForm.relayHost} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, relayHost: event.target.value }))} required /></label>
                        <label>포트<input type="number" min="1" max="65535" value={mailProviderOperationsForm.relayPort} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, relayPort: event.target.value }))} required /></label>
                        <label>TLS<select value={mailProviderOperationsForm.tlsMode} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, tlsMode: event.target.value as MailProviderOperationsForm["tlsMode"] }))}><option value="none">none</option><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label>
                        <label>발신 주소<input type="email" value={mailProviderOperationsForm.senderAddress} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, senderAddress: event.target.value }))} /></label>
                        <label>SMTP 사용자<input autoComplete="off" value={mailProviderOperationsForm.username} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, username: event.target.value }))} placeholder="변경할 때만 입력" /></label>
                        <label>SMTP 비밀번호<input type="password" autoComplete="new-password" value={mailProviderOperationsForm.password} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, password: event.target.value }))} placeholder="변경할 때만 입력" /></label>
                        <label>DKIM 도메인<input value={mailProviderOperationsForm.dkimDomain} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, dkimDomain: event.target.value }))} /></label>
                        <label>DKIM selector<input value={mailProviderOperationsForm.dkimSelector} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, dkimSelector: event.target.value }))} /></label>
                        <label>DKIM 개인키<textarea value={mailProviderOperationsForm.dkimPrivateKey} onChange={(event) => setMailProviderOperationsForm((current) => ({ ...current, dkimPrivateKey: event.target.value }))} placeholder="변경할 때만 입력하며 저장 후 다시 표시하지 않습니다." /></label>
                        <button type="submit" disabled={loading}>Provider 설정 저장</button>
                      </form>
                    </div>
                  ) : null}
                  {operationsDialog === "storage" ? <div className="stack-list"><span className="mini-stat">저장소 {health?.components.storage?.status ?? "unknown"}</span><span className="mini-stat">DB {health?.components.db?.status ?? "unknown"}</span><button type="button" onClick={() => { void refreshDirectory(); void refreshMonitoring(); setOperationsDialog(null); }}>점검 실행</button></div> : null}
                  {operationsDialog === "brand" ? <div className="stack-list"><span className="mini-stat">회사명/도메인은 초기 설정 원천의 읽기 전용 값입니다.</span><button type="button" onClick={() => { void handleUiContractSave(); setOperationsDialog(null); }}>현재 설정 저장</button><button type="button" className="secondary" onClick={() => void reloadUiContract()}>저장값 다시 불러오기</button></div> : null}
                  {operationsDialog === "language" ? <div className="ops-toolbar-grid"><label className="compact-field"><span>언어</span><select value={locale} onChange={(event) => saveLocale(event.target.value as AppLocale)}>{supportedLocales.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="compact-field"><span>시간대</span><select value={timezone} onChange={(event) => saveTimezone(event.target.value)}>{supportedTimezones.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div> : null}
                  {(operationsDialog === "audit" || operationsDialog === "help") && operationDetail ? <div className="stack-list"><strong>{operationDetail.title}</strong>{operationDetail.lines.map((line) => <p key={line}>{line}</p>)}</div> : null}
                </section>
              </div>
            ) : null}
            {bulkConfirmation ? (
              <div className="management-modal-backdrop" role="presentation" onClick={() => { if (!loading) { setBulkConfirmation(null); setBulkActionError(""); } }}>
                <section className="management-modal management-confirm-modal" role="dialog" aria-modal="true" aria-label="일괄 작업 확인" onClick={(event) => event.stopPropagation()}>
                  <div className="management-modal-head"><strong>{bulkConfirmation.action === "delete" ? "삭제 상태 전환 확인" : "일괄 상태 변경 확인"}</strong><button type="button" className="secondary" onClick={() => { setBulkConfirmation(null); setBulkActionError(""); }} disabled={loading}>닫기</button></div>
                  <p>{bulkConfirmation.target === "users" ? "사용자" : bulkConfirmation.target === "departments" ? "부서" : "권한 역할"} {bulkConfirmation.ids.length}개를 {bulkConfirmation.action === "delete" ? "deleted 상태로 전환" : bulkConfirmation.action === "active" ? "활성화" : "비활성화"}합니다.</p>
                  {bulkConfirmation.action === "delete" ? <p className="muted">삭제 가능 여부와 차단 사유는 서버가 다시 검증합니다. 연결 사용자·하위 부서·기본 역할·현재 관리자 계정은 서버 정책에 따라 차단될 수 있습니다.</p> : null}
                  {bulkActionError ? <div className="notice warning"><strong>작업 차단</strong><p>{bulkActionError}</p></div> : null}
                  <div className="actions compact-actions"><button type="button" className={bulkConfirmation.action === "delete" ? "danger-action" : ""} onClick={() => void executeBulkAction()} disabled={loading}>확인</button><button type="button" className="secondary" onClick={() => { setBulkConfirmation(null); setBulkActionError(""); }} disabled={loading}>취소</button></div>
                </section>
              </div>
            ) : null}
          </section>
        </section>
      )}
    </main>
  );
}
