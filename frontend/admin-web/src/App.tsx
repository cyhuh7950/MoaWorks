import { FormEvent, useEffect, useState } from "react";

import {
  apiBase,
  clearToken,
  createDepartment,
  createRole,
  createUser,
  fetchDirectory,
  fetchHealth,
  fetchMonitoringEvents,
  fetchMonitoringOverview,
  fetchApprovalAuditLogs,
  getStoredToken,
  fetchUiContract,
  initializeSetup,
  login,
  storeToken,
  testRelay,
  fetchTranslationPolicy,
  fetchTranslationStatus,
  requestTranslation,
  type TranslationItem,
  type TranslationRequest,
  type TranslationPolicy,
  type TranslationResponse,
  type TranslationStatus,
  type UiContract as ServerUiContract,
  updateTranslationPolicy,
  updateUiContract,
  type DirectoryOverview,
  type DomainVerifyResponse,
  type HealthResponse,
  type MonitoringEvent,
  type MonitoringOverview,
  type ApprovalAuditLog,
  type RelayTestResponse,
  updateRole,
  updateUser,
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
  email: string;
  password: string;
};

type UserForm = {
  userId: string;
  name: string;
  email: string;
  password: string;
  departmentId: string;
  roleId: string;
  status: string;
  userType: string;
};

const initialUserForm: UserForm = {
  userId: "",
  name: "",
  email: "",
  password: "",
  departmentId: "",
  roleId: "",
  status: "active",
  userType: "user",
};

type UiContract = {
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
};

type AdminMenuKey = "dashboard" | "users" | "departments" | "roles" | "service" | "mail" | "storage" | "approval" | "brand" | "language" | "help";

const adminMenus: Array<{ key: AdminMenuKey; label: string; description: string }> = [
  { key: "dashboard", label: "대시보드", description: "상태와 빠른 작업" },
  { key: "users", label: "사용자 관리", description: "사용자 생성/수정/파일 업로드" },
  { key: "departments", label: "부서 관리", description: "조직 단위 관리" },
  { key: "roles", label: "권한 관리", description: "역할과 권한 상태" },
  { key: "service", label: "서비스 운영", description: "도메인 검증과 Relay 테스트" },
  { key: "mail", label: "메일 설정", description: "Relay와 메일 제공자" },
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

function mergeUiContract(raw: Partial<UiContract> | null | undefined): UiContract {
  return {
    brand: {
      ...defaultUiContract.brand,
      ...(raw?.brand ?? {}),
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

const adminCopy: Record<AppLocale, Record<string, string>> = {
  "ko-KR": {
    adminEmail: "관리자 이메일",
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
    adminEmail: "Admin email",
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
    adminEmail: "管理者メール",
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
    adminEmail: "管理员邮箱",
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
    adminEmail: "Correo admin",
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
    adminEmail: "Email admin",
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
    adminEmail: "Admin-E-Mail",
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

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(resolveLocale(window.localStorage.getItem("moaworks.locale")));
  const copy = adminCopy[locale];
  const [timezone, setTimezone] = useState(window.localStorage.getItem("moaworks.timezone") || "Asia/Seoul");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [overview, setOverview] = useState<DirectoryOverview | null>(null);
  const [monitoringOverview, setMonitoringOverview] = useState<MonitoringOverview | null>(null);
  const [monitoringEvents, setMonitoringEvents] = useState<MonitoringEvent[]>([]);
  const [approvalAuditLogs, setApprovalAuditLogs] = useState<ApprovalAuditLog[]>([]);
  const [domainResult, setDomainResult] = useState<DomainVerifyResponse | null>(null);
  const [relayResult, setRelayResult] = useState<RelayTestResponse | null>(null);
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus | null>(null);
  const [translationPolicy, setTranslationPolicy] = useState<TranslationPolicy | null>(null);
  const [translationSource, setTranslationSource] = useState("");
  const [translationTargetLocale, setTranslationTargetLocale] = useState("en");
  const [translationResult, setTranslationResult] = useState<TranslationItem[]>([]);
  const [translationError, setTranslationError] = useState("");
  const [translationLoading, setTranslationLoading] = useState(false);
  const [form, setForm] = useState<SetupForm>(initialForm);
  const [loginForm, setLoginForm] = useState<LoginForm>({ email: "", password: "" });
  const [userForm, setUserForm] = useState<UserForm>(initialUserForm);
  const [userSearch, setUserSearch] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [rolePermissions, setRolePermissions] = useState("mail:read,approval:read,profile:read");
  const [domainInput, setDomainInput] = useState("");
  const [relayRecipient, setRelayRecipient] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(getStoredToken());
  const [activeAdminMenu, setActiveAdminMenu] = useState<AdminMenuKey>("dashboard");
  const [uiContractDraft, setUiContractDraft] = useState<UiContract>(() => defaultUiContract);
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
    setActiveAdminMenu("dashboard");
    if (nextMessage) {
      setErrors([nextMessage]);
    }
  }

  async function refreshHealth() {
    const data = await fetchHealth();
    setHealth(data);
    return data;
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
      email: current.email || data.users.find((item) => item.userType === "admin")?.userEmail || "",
      password: current.password,
    }));
    setUserForm((current) => ({
      ...current,
      departmentId: current.departmentId || data.departments[0]?.id || "",
      roleId: current.roleId || data.roles.find((item) => item.name === "일반사용자")?.id || data.roles[0]?.id || "",
    }));
  }

  async function refreshMonitoring(nextToken = token) {
    if (!nextToken) return;
    const nextMonitoring = await fetchMonitoringOverview(nextToken);
    setMonitoringOverview(nextMonitoring);
    const events = await fetchMonitoringEvents(nextToken);
    setMonitoringEvents(events.events ?? []);
  }

  async function refreshApprovalAuditLogs(nextToken = token) {
    if (!nextToken) return;
    const response = await fetchApprovalAuditLogs(nextToken);
    setApprovalAuditLogs(response.logs ?? []);
  }

  function normalizeTranslationLocale(value: string) {
    return value
      .trim()
      .replace("_", "-")
      .toLowerCase()
      .split("-")[0];
  }

  async function refreshTranslationState(nextToken = token) {
    const status = await fetchTranslationStatus();
    setTranslationStatus(status);
    if (!nextToken) {
      setTranslationPolicy(null);
      return;
    }
    try {
      const policy = await fetchTranslationPolicy(nextToken);
      setTranslationPolicy(policy);
      setTranslationTargetLocale(toTranslationLocale(policy.supportedTargetLocales.includes(translationTargetLocale) ? translationTargetLocale : policy.supportedTargetLocales[0]));
    } catch (error) {
      setTranslationPolicy(null);
      setTranslationError(error instanceof Error ? error.message : "번역 정책 조회 실패");
    }
  }

  function saveLocale(nextLocale: AppLocale) {
    setLocale(nextLocale);
    window.localStorage.setItem("moaworks.locale", nextLocale);
  }

  function saveTimezone(nextTimezone: string) {
    setTimezone(nextTimezone);
    window.localStorage.setItem("moaworks.timezone", nextTimezone);
  }

  async function handleUiContractSave() {
    if (!token) {
      setErrors(["관리자 로그인 후 설정을 저장할 수 있습니다."]);
      return;
    }
    try {
      const saved = await updateUiContract(token, uiContractDraft as ServerUiContract);
      setUiContractDraft(mergeUiContract(saved));
      setMessage(saved.messages.success);
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "설정 저장 실패"]);
    }
  }

  async function reloadUiContract(nextToken = token) {
    if (!nextToken) return;
    const contract = await fetchUiContract(nextToken);
    setUiContractDraft(mergeUiContract(contract));
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

  async function runTranslationDemo(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setTranslationError("로그인 후 번역 데모를 실행하세요.");
      return;
    }
    const trimmed = translationSource.trim();
    if (!trimmed) {
      setTranslationError("번역 원문을 입력하세요.");
      return;
    }
    const sourceLocale = toTranslationLocale(locale);
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
    void refreshTranslationState();
  }, []);

  useEffect(() => {
    if (token && health?.initialized) {
      void refreshDirectory(token).catch((error) => {
        resetAdminSession(error instanceof Error ? error.message : "관리 데이터 조회 실패");
      });
      void refreshMonitoring(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "운영 모니터링 조회 실패"]);
      });
      void refreshApprovalAuditLogs(token).catch((error) => {
        setErrors((current) => [...current, error instanceof Error ? error.message : "결재 감사 로그 조회 실패"]);
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
    setLoading(true);
    setErrors([]);
    setMessage("");
    try {
      const response = await login(loginForm);
      storeToken(response.accessToken);
      setToken(response.accessToken);
      setMessage(`관리자 로그인 완료: ${response.user.userName}`);
      await refreshDirectory(response.accessToken);
      await refreshTranslationState(response.accessToken);
      await reloadUiContract(response.accessToken);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "로그인 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDepartmentCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await createDepartment(token, { name: departmentName, sortOrder: 100 });
      setDepartmentName("");
      setMessage("부서가 생성되었습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "부서 생성 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await createRole(token, {
        name: roleName,
        permissions: rolePermissions.split(",").map((item) => item.trim()).filter(Boolean),
      });
      setRoleName("");
      setMessage("권한 역할이 생성되었습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "권한 생성 실패"]);
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
          password: userForm.password || undefined,
          departmentId: userForm.departmentId,
          roleId: userForm.roleId,
          status: userForm.status,
        });
        setMessage("사용자 정보가 수정되었습니다.");
      } else {
        await createUser(token, {
          name: userForm.name,
          email: userForm.email,
          password: userForm.password,
          departmentId: userForm.departmentId,
          roleId: userForm.roleId,
          status: userForm.status,
          userType: userForm.userType,
        });
        setMessage("사용자와 메일 계정이 함께 생성되었습니다.");
      }
      setUserForm((current) => ({
        ...initialUserForm,
        departmentId: current.departmentId,
        roleId: current.roleId,
      }));
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "사용자 저장 실패"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivateUser(userId: string) {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    try {
      await updateUser(token, userId, { status: "inactive" });
      setMessage("사용자와 메일 계정을 비활성화했습니다.");
      await refreshDirectory();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "사용자 비활성화 실패"]);
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

  const isHealthPending = health === null;
  const initialized = health?.initialized === true;
  const showSetupWizard = health?.initialized === false;
  const showLoginPanel = initialized && (!token || !overview);
  const hasStoredSessionButNoOverview = initialized && Boolean(token) && !overview;
  const supportedTranslationTargets = translationPolicy?.supportedTargetLocales?.length ? translationPolicy.supportedTargetLocales : (translationStatus?.supportedTargetLocales ?? ["en"]);
  const activeMenu = adminMenus.find((item) => item.key === activeAdminMenu) ?? adminMenus[0];
  const showAdminConsole = initialized && Boolean(token) && Boolean(overview);
  const filteredUsers = overview?.users.filter((item) => {
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

  const renderAdminPanel = () => {
    if (!overview) {
      return null;
    }

    const messageCategories = [
      { title: "오류", body: translationError || errors[0] || uiContractDraft.messages.error },
      { title: "경고", body: warnings[0] || uiContractDraft.messages.warning },
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
                <p className="muted">운영 개요, 경고/알림, 최근 이벤트, 빠른 작업만 표시합니다.</p>
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
                  <p className="muted">{item.description}</p>
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
                <p className="muted">{overview.company.domain}</p>
              </article>
              <article className="status-card">
                <strong>사용자</strong>
                <p>{overview.users.length}명</p>
                <p className="muted">활성 {overview.users.filter((item) => item.status === "active").length}명</p>
              </article>
              <article className="status-card">
                <strong>부서 / 권한</strong>
                <p>{overview.departments.length}개 / {overview.roles.length}개</p>
                <p className="muted">서버에서만 권한 판단</p>
              </article>
              <article className="status-card">
                <strong>빠른 작업</strong>
                <p>사용자 관리, 서비스 운영, 저장소/DB 상태 점검으로 바로 이동합니다.</p>
                <div className="row-actions">
                  <button type="button" className="secondary" onClick={() => setActiveAdminMenu("users")}>사용자 관리</button>
                  <button type="button" className="secondary" onClick={() => setActiveAdminMenu("service")}>서비스 운영</button>
                  <button type="button" className="secondary" onClick={() => setActiveAdminMenu("storage")}>저장소/DB 상태</button>
                </div>
              </article>
            </div>
          </section>
        );
      case "users":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{t(locale, "userManagement")}</h2>
                <p className="muted">사용자 검색, 목록, 생성/수정, 상태 관리, 파일 업로드 경로를 관리합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>파일 업로드</strong>
                <p>사용자 일괄 등록 파일 업로드 경로는 이 메뉴 안에서만 유지합니다.</p>
                <p className="muted">현재 단계: 목록/정합성 검토 후 업로드 절차 연결</p>
              </article>
              <article className="status-card">
                <strong>상태 관리</strong>
                <p>비활성 사용자 차단과 메일 계정 상태 정합성을 함께 확인합니다.</p>
              </article>
            </div>
            <label className="field-label">
              사용자 검색
              <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="이름, 이메일, 부서, 권한" />
            </label>
            <form className="wizard" onSubmit={handleUserSubmit}>
              <div className="field-grid">
                <label>
                  사용자 이름
                  <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                </label>
                <label>
                  이메일
                  <input type="email" value={userForm.email} disabled={Boolean(userForm.userId)} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
                </label>
                <label>
                  초기/변경 비밀번호
                  <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                </label>
                <label>
                  부서
                  <select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })}>
                    {overview.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>
                  권한 역할
                  <select value={userForm.roleId} onChange={(e) => setUserForm({ ...userForm, roleId: e.target.value })}>
                    {overview.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>
                  상태
                  <select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
                <label>
                  사용자 유형
                  <select value={userForm.userType} disabled={Boolean(userForm.userId)} onChange={(e) => setUserForm({ ...userForm, userType: e.target.value })}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
              </div>
              <div className="actions">
                <button type="submit" disabled={loading}>{userForm.userId ? copy.editUser : copy.createUser}</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setUserForm({
                    ...initialUserForm,
                    departmentId: overview.departments[0]?.id || "",
                    roleId: overview.roles[0]?.id || "",
                  })}
                >
                  {copy.newUser}
                </button>
              </div>
            </form>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>부서</th>
                    <th>권한</th>
                    <th>사용자 상태</th>
                    <th>메일 상태</th>
                    <th>정합성</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((item) => (
                    <tr key={item.userId}>
                      <td>{item.userName}</td>
                      <td>{item.userEmail}</td>
                      <td>{item.departmentName}</td>
                      <td>{item.roleName}</td>
                      <td>{item.status}</td>
                      <td>{item.mailAccountStatus}</td>
                      <td>{item.consistencyIssues.length === 0 ? "정상" : item.consistencyIssues.map((issue) => issue.code).join(", ")}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setUserForm({
                              userId: item.userId,
                              name: item.userName,
                              email: item.userEmail,
                              password: "",
                              departmentId: item.departmentId,
                              roleId: item.roleId,
                              status: item.status,
                              userType: item.userType,
                            })}
                          >
                            {copy.edit}
                          </button>
                          {item.userType !== "admin" && item.status === "active" ? (
                            <button type="button" className="secondary" onClick={() => void handleDeactivateUser(item.userId)}>
                              {copy.deactivate}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={8}>{userSearch ? "조건에 맞는 사용자가 없습니다." : "등록된 사용자가 없습니다."}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        );
      case "departments":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>부서 관리</h2>
                <p className="muted">부서 목록, 구조, 생성/수정 업무만 표시합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>부서 구조</strong>
                <p>{overview.departments.map((item) => item.name).join(" / ") || "등록된 부서가 없습니다."}</p>
              </article>
            </div>
            <form className="compact-form" onSubmit={handleDepartmentCreate}>
              <label>
                부서명
                <input value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} />
              </label>
              <button type="submit" disabled={loading}>{copy.createDepartment}</button>
            </form>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>부서명</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.departments.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                    </tr>
                  ))}
                  {overview.departments.length === 0 ? <tr><td>등록된 부서가 없습니다.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        );
      case "roles":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>권한 관리</h2>
                <p className="muted">권한 역할 현황, 역할 생성, 권한 편집, 활성/비활성 전환만 표시합니다.</p>
              </div>
            </div>
            <form className="compact-form" onSubmit={handleRoleCreate}>
              <label>
                역할명
                <input value={roleName} onChange={(e) => setRoleName(e.target.value)} />
              </label>
              <label>
                권한 목록
                <input value={rolePermissions} onChange={(e) => setRolePermissions(e.target.value)} />
              </label>
              <button type="submit" disabled={loading}>{copy.createRole}</button>
            </form>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>역할명</th>
                    <th>상태</th>
                    <th>권한 수</th>
                    <th>권한 편집/전환</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.roles.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.status}</td>
                      <td>{item.permissions.length}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={loading}
                            onClick={() => {
                              setRoleName(item.name);
                              setRolePermissions(item.permissions.join(", "));
                            }}
                          >
                            권한 편집
                          </button>
                          {item.status === "active" ? (
                            <button
                              type="button"
                              className="secondary"
                              disabled={loading || item.name === "관리자"}
                              onClick={() => void handleRoleStatus(item.id, "inactive")}
                            >
                              {copy.deactivate}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary"
                              disabled={loading}
                              onClick={() => void handleRoleStatus(item.id, "active")}
                            >
                              {copy.activate}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      case "service":
        return (
          <section className="panel split-panel">
            <article>
              <div className="panel-head">
                <div>
                  <h2>{copy.verifyDomain}</h2>
                  <p className="muted">회사 도메인 기준 MX/SPF/DKIM/DMARC 검증만 이 메뉴에서 수행합니다.</p>
                </div>
              </div>
              <form className="compact-form" onSubmit={handleDomainVerify}>
                <label>
                  검증 도메인
                  <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
                </label>
                <button type="submit" disabled={loading}>{copy.verifyDomainAction}</button>
              </form>
              {domainResult ? (
                <div className="stack-list">
                  <p className="result">전체 상태: {domainResult.overallStatus}</p>
                  {domainResult.checks.map((item) => (
                    <article key={`${item.recordType}-${item.host}`} className="status-card">
                      <div className="status-title">
                        <strong>{item.recordType}</strong>
                        <span className={`badge badge-${item.status}`}>{item.status}</span>
                      </div>
                      <p>{item.host}</p>
                      <p className="muted">{item.expectedValue}</p>
                      <p>{item.message}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </article>
            <article>
              <div className="panel-head">
                <div>
                  <h2>{copy.relayTest}</h2>
                  <p className="muted">Relay 테스트와 운영 점검 결과만 이 메뉴에서 다룹니다.</p>
                </div>
              </div>
              <form className="compact-form" onSubmit={handleRelayTest}>
                <label>
                  테스트 수신자
                  <input type="email" value={relayRecipient} onChange={(e) => setRelayRecipient(e.target.value)} />
                </label>
                <button type="submit" disabled={loading}>{copy.relayTestAction}</button>
              </form>
              <article className="status-card">
                <strong>운영 점검 결과</strong>
                <p>열린 경고 {monitoringOverview?.alertOpenCount ?? 0}건</p>
                <p className="muted">디스크 사용률 {monitoringOverview?.diskUsagePercent ?? 0}% / 승인 지연 {monitoringOverview?.approvalBacklogCount ?? 0}건</p>
              </article>
              {relayResult ? (
                <div className={`notice ${relayResult.status === "success" ? "success" : "warning"}`}>
                  <strong>{relayResult.status}</strong>
                  <p>{relayResult.message}</p>
                </div>
              ) : null}
            </article>
          </section>
        );
      case "mail":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>메일 설정</h2>
                <p className="muted">메일 제공자 상태, Relay 상태, 메일 테스트만 표시합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>메일 제공자 상태</strong>
                <p>{overview.mailProvider.providerType}</p>
                <p className="muted">활성 여부: {overview.mailProvider.active ? "active" : "inactive"}</p>
              </article>
              <article className="status-card">
                <strong>Relay 상태</strong>
                <p>{overview.mailProvider.relayHost}:{overview.mailProvider.relayPort}</p>
                <p className="muted">마지막 테스트: {overview.mailProvider.lastTestStatus}</p>
              </article>
            </div>
            <form className="compact-form" onSubmit={handleRelayTest}>
              <label>
                메일 테스트 수신자
                <input type="email" value={relayRecipient} onChange={(e) => setRelayRecipient(e.target.value)} />
              </label>
              <button type="submit" disabled={loading}>{copy.relayTestAction}</button>
            </form>
            {relayResult ? (
              <div className={`notice ${relayResult.status === "success" ? "success" : "warning"}`}>
                <strong>{relayResult.status}</strong>
                <p>{relayResult.message}</p>
              </div>
            ) : null}
          </section>
        );
      case "storage":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>저장소/DB 상태</h2>
                <p className="muted">저장소 상태, DB 상태, 백업/복구 요약만 표시합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>저장소 상태</strong>
                <p>{health?.components.storage?.status ?? "unknown"}</p>
                <p className="muted">{health?.components.storage?.message ?? "저장소 상태를 아직 확인하지 못했습니다."}</p>
              </article>
              <article className="status-card">
                <strong>DB 상태</strong>
                <p>{health?.components.db?.status ?? "unknown"}</p>
                <p className="muted">{health?.components.db?.message ?? "DB 상태를 아직 확인하지 못했습니다."}</p>
              </article>
              <article className="status-card">
                <strong>백업/복구 요약</strong>
                <p>{health?.components.storage?.details?.backup_status || "요약 미수집"}</p>
                <p className="muted">복구 절차: 운영 저장소 정책 및 DB 스냅샷 기준</p>
              </article>
            </div>
          </section>
        );
      case "approval":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{copy.approvalAuditTitle}</h2>
                <p className="muted">결재 감사 로그, 상태 전이 이벤트, 필터, 상세 조회만 표시합니다.</p>
              </div>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => void refreshApprovalAuditLogs()}>
                  {copy.refreshApprovalLogs}
                </button>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>필터</strong>
                <p>문서 ID 기준 상세 조회와 최근 상태 전이 이벤트 확인</p>
              </article>
            </div>
            <div className="table-wrap">
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
                  {approvalAuditLogs.slice(0, 20).map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                      <td>{item.event}</td>
                      <td>{item.targetId}</td>
                      <td>{item.actorUserName}</td>
                      <td>{`${item.statusBefore ?? "-"} -> ${item.statusAfter ?? "-"}`}</td>
                      <td>{item.reason ?? "-"}</td>
                    </tr>
                  ))}
                  {approvalAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6}>결재 감사 로그가 없습니다.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        );
      case "brand":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>브랜드/화면 설정</h2>
                <p className="muted">브랜드 설정, 메뉴 구성, 설정 계약, 반영 확인, 사용자 화면 연결만 표시합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>브랜드 설정</strong>
                <p>{overview.company.name} 기준 대표/보조/강조/차단 색상을 관리합니다.</p>
              </article>
              <article className="status-card">
                <strong>메뉴 구성</strong>
                <p>{uiContractDraft.menuOrder.join(" > ")}</p>
                <p className="muted">홈 카드 우선순위: {uiContractDraft.homeCardOrder.join(" > ")}</p>
              </article>
              <article className="status-card">
                <strong>반영 확인</strong>
                <p>user-web / mobile-app / desktop-client 상단 바, 메뉴 순서, Help 경로 반영</p>
              </article>
            </div>
            <div className="split-panel">
              <article>
                <h3>설정 계약</h3>
                <form className="wizard" onSubmit={(event) => event.preventDefault()}>
                  <div className="field-grid">
                    <label>
                      대표 색상
                      <input value={uiContractDraft.brand.primary} onChange={(e) => setUiContractDraft((current) => ({ ...current, brand: { ...current.brand, primary: e.target.value } }))} />
                    </label>
                    <label>
                      보조 색상
                      <input value={uiContractDraft.brand.secondary} onChange={(e) => setUiContractDraft((current) => ({ ...current, brand: { ...current.brand, secondary: e.target.value } }))} />
                    </label>
                    <label>
                      강조 색상
                      <input value={uiContractDraft.brand.accent} onChange={(e) => setUiContractDraft((current) => ({ ...current, brand: { ...current.brand, accent: e.target.value } }))} />
                    </label>
                    <label>
                      차단 색상
                      <input value={uiContractDraft.brand.blocked} onChange={(e) => setUiContractDraft((current) => ({ ...current, brand: { ...current.brand, blocked: e.target.value } }))} />
                    </label>
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
                <h3>사용자 화면 연결</h3>
                <div className="overview-grid">
                  {settingsContracts.map((item) => (
                    <article key={item.title} className="status-card">
                      <strong>{item.title}</strong>
                      <p>{item.values}</p>
                      <p className="muted">반영 대상: {item.targets}</p>
                    </article>
                  ))}
                </div>
              </article>
            </div>
          </section>
        );
      case "language":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>다국어/메시지</h2>
                <p className="muted">언어, 시간대, 상태 메시지, 메시지 카테고리만 표시합니다.</p>
              </div>
            </div>
            <div className="status-grid">
              <article className="status-card">
                <strong>언어</strong>
                <select value={locale} onChange={(event) => saveLocale(event.target.value as AppLocale)} style={{ display: "block", width: "100%", marginTop: 8 }}>
                  {supportedLocales.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </article>
              <article className="status-card">
                <strong>시간대</strong>
                <select value={timezone} onChange={(event) => saveTimezone(event.target.value)} style={{ display: "block", width: "100%", marginTop: 8 }}>
                  {supportedTimezones.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </article>
            </div>
            <div className="overview-grid">
              {messageCategories.map((item) => (
                <article key={item.title} className="status-card">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>
        );
      case "help":
        return (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>도움말/정책</h2>
                <p className="muted">운영 가이드, 정책 안내, 공통 인증 계약 요약, 점검 항목만 표시합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>운영 가이드</strong>
                <p>초기 설정, 관리자 로그인, 사용자 생성, 서비스 운영 점검 순서로 확인합니다.</p>
              </article>
              <article className="status-card">
                <strong>정책 안내</strong>
                <p>정책 본문은 사용자 웹/모바일/설치형의 Help 및 정책 안내 영역에서 확인합니다.</p>
              </article>
              <article className="status-card">
                <strong>공통 인증 계약 요약</strong>
                <p className="muted">{copy.authContract}</p>
              </article>
              <article className="status-card">
                <strong>점검 항목</strong>
                <p>DB 연결, health.initialized, 로그인 화면 전환, 관리자 메뉴 진입 확인</p>
              </article>
            </div>
          </section>
        );
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

      <section className="panel" hidden={!token || showAdminConsole || !initialized}>
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
            <p className="eyebrow">{t(locale, "appTitle")}</p>
            <h1>MoaWorks 관리자 플랫폼</h1>
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
            {errors.length > 0 && (
              <div className="notice danger">
                <strong>확인 필요</strong>
                <ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="notice warning">
                <strong>확인 필요</strong>
                <ul>{warnings.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <form className="compact-form" onSubmit={handleLogin}>
              <label>
                {copy.adminEmail}
                <input type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
              </label>
              <label>
                {copy.adminPassword}
                <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
              </label>
              <button type="submit" disabled={loading}>로그인</button>
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

      {(message || errors.length > 0 || warnings.length > 0) && !showAdminConsole && !showLoginPanel && !showSetupWizard && !isHealthPending && (
        <section className="panel">
          {message && <p className="result">{message}</p>}
          {errors.length > 0 && (
            <div className="notice danger">
              <strong>확인 필요</strong>
              <ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="notice warning">
              <strong>확인 필요</strong>
              <ul>{warnings.map((item) => <li key={item}>{item}</li>)}</ul>
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
            <div>
              <p className="eyebrow">MoaWorks Admin</p>
              <h2>{overview.company.name}</h2>
              <p className="muted">{overview.company.domain}</p>
            </div>
            <nav className="console-menu" aria-label="관리자 메뉴">
              {adminMenus.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === activeAdminMenu ? "menu-item active" : "menu-item"}
                  onClick={() => setActiveAdminMenu(item.key)}
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              ))}
            </nav>
            <div className="console-profile">
              <strong>관리자 세션</strong>
              <p className="muted">{loginForm.email || "관리자"}</p>
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
                <p className="muted">{activeMenu.description}</p>
              </div>
              <div className="topbar-actions">
                <input aria-label="빠른 이동" placeholder="메뉴 또는 작업 검색" readOnly value={activeMenu.label} />
                <button type="button" className="secondary" onClick={() => void refreshMonitoring()}>
                  경고/알림
                </button>
              </div>
            </div>
            {renderAdminPanel()}
          </section>
        </section>
      )}
    </main>
  );
}
