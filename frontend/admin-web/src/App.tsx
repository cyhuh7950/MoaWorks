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

type AdminMenuKey = "dashboard" | "organization" | "service" | "approval" | "brand" | "language" | "help";

const adminMenus: Array<{ key: AdminMenuKey; label: string; description: string }> = [
  { key: "dashboard", label: "대시보드", description: "상태와 빠른 작업" },
  { key: "organization", label: "조직 관리", description: "사용자, 부서, 권한" },
  { key: "service", label: "서비스 운영", description: "도메인, Relay, 메일" },
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
      setWarnings(response.warnings ?? []);
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

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">{t(locale, "appTitle")}</p>
        <h1>{t(locale, "appDescription")}</h1>
        <p className="lead">
          {t(locale, "systemStatus")} / {t(locale, "manual")} / {t(locale, "language")}
        </p>
        <p className="api-base">API Base: {apiBase}</p>
      </section>

      <section className="panel" hidden={showAdminConsole}>
        <div className="panel-head">
          <div>
            <h2>{t(locale, "language")} / {t(locale, "timezone")}</h2>
            <p className="muted">
              언어/시간대는 브라우저 표시 기준 설정이며 핵심 업무 API 계약에는 영향을 주지 않습니다.
            </p>
          </div>
        </div>
        <div className="field-grid">
          <label>
            언어
            <select value={locale} onChange={(event) => saveLocale(event.target.value as AppLocale)}>
              {supportedLocales.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            시간대
            <select value={timezone} onChange={(event) => saveTimezone(event.target.value)}>
              {supportedTimezones.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
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

      <section className="panel" hidden={showAdminConsole}>
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

      {(message || errors.length > 0 || warnings.length > 0) && (
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

      {showLoginPanel && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>관리자 로그인</h2>
              <p className="muted">초기 설정이 완료된 상태입니다. 관리자 전용 운영 API는 로그인 후 Bearer 토큰으로만 접근합니다.</p>
            </div>
          </div>
          {hasStoredSessionButNoOverview && (
            <div className="notice warning">
              저장된 관리자 세션을 확인하지 못했습니다. 다시 로그인해 운영 화면을 복구하세요.
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
                <button type="button" onClick={() => setActiveAdminMenu("organization")}>
                  사용자 추가
                </button>
              </div>
            </div>
          <section className="panel" hidden={activeAdminMenu !== "dashboard"}>
            <div className="panel-head">
              <div>
                <h2>{copy.overviewTitle}</h2>
                <p className="muted">관리자 API와 일반 사용자 인증 API를 분리한 단계 3 기준 운영 화면입니다.</p>
              </div>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => void refreshDirectory()}>
                  {copy.refreshOps}
                </button>
                <button type="button" className="secondary" onClick={() => void refreshMonitoring()}>
                  {copy.refreshMonitoring}
                </button>
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
                  }}
                >
                  {t(locale, "logout")}
                </button>
              </div>
            </div>
            {health && (
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
            )}
            <div className="overview-grid">
              <article className="status-card">
                <strong>승인 지연</strong>
                <p>{monitoringOverview?.approvalBacklogCount ?? 0}건</p>
                <p className="muted">미완료 결재 문서</p>
              </article>
              <article className="status-card">
                <strong>메일 Relay 실패(1h)</strong>
                <p>{monitoringOverview?.relayFailureCount1h ?? 0}건</p>
                <p className="muted">1시간 내 발생</p>
              </article>
              <article className="status-card">
                <strong>디스크 사용률</strong>
                <p>{monitoringOverview?.diskUsagePercent ?? 0}%</p>
                <p className="muted">활성 경고 {monitoringOverview?.alertOpenCount ?? 0}건</p>
              </article>
            </div>
            <div className="quick-actions">
              <button type="button" onClick={() => setActiveAdminMenu("organization")}>사용자 추가</button>
              <button type="button" className="secondary" onClick={() => setActiveAdminMenu("service")}>도메인 검증</button>
              <button type="button" className="secondary" onClick={() => setActiveAdminMenu("service")}>Relay 테스트</button>
              <button type="button" className="secondary" onClick={() => void reloadUiContract()}>설정 저장값 다시 불러오기</button>
            </div>
            <div className="status-card">
              <strong>운영 이벤트(최근)</strong>
              <ul>
                {monitoringEvents.slice(0, 3).map((item) => (
                  <li key={item.eventId}>
                    [{item.severity}] {item.title}
                  </li>
                ))}
                {monitoringEvents.length === 0 && <li>운영 이벤트가 없습니다.</li>}
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
                <strong>Relay</strong>
                <p>{overview.mailProvider.providerType}</p>
                <p className="muted">
                  {overview.mailProvider.relayHost}:{overview.mailProvider.relayPort} / 마지막 상태 {overview.mailProvider.lastTestStatus}
                </p>
              </article>
            </div>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "approval"}>
            <div className="panel-head">
              <div>
                <h2>{copy.approvalAuditTitle}</h2>
                <p className="muted">직권 승인/반려 포함 결재 상태 전이 결과를 운영자가 확인합니다.</p>
              </div>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => void refreshApprovalAuditLogs()}>
                  {copy.refreshApprovalLogs}
                </button>
              </div>
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
                  {approvalAuditLogs.length === 0 && (
                    <tr>
                      <td colSpan={6}>결재 감사 로그가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "organization"}>
            <div className="panel-head">
              <div>
                <h2>{t(locale, "userManagement")}</h2>
                <p className="muted">사용자 생성 시 서버에서 메일 계정을 자동 생성합니다.</p>
              </div>
            </div>
            <form className="wizard" onSubmit={handleUserSubmit}>
              <div className="field-grid">
                <label>
                  사용자 이름
                  <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                </label>
                <label>
                  이메일
                  <input
                    type="email"
                    value={userForm.email}
                    disabled={Boolean(userForm.userId)}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  />
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
                  {overview.users.map((item) => (
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
                          {item.userType !== "admin" && item.status === "active" && (
                            <button type="button" className="secondary" onClick={() => void handleDeactivateUser(item.userId)}>
                              {copy.deactivate}
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

          <section className="panel split-panel" hidden={activeAdminMenu !== "organization"}>
            <article>
              <div className="panel-head">
                <div>
                  <h2>{copy.addDepartment}</h2>
                  <p className="muted">운영자 관리 화면에서 조직 단위를 확장합니다.</p>
                </div>
              </div>
              <form className="compact-form" onSubmit={handleDepartmentCreate}>
                <label>
                  부서명
                  <input value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} />
                </label>
                <button type="submit" disabled={loading}>{copy.createDepartment}</button>
              </form>
            </article>

            <article>
              <div className="panel-head">
                <div>
                  <h2>{copy.addRole}</h2>
                  <p className="muted">콤마 구분 권한 문자열로 서버 역할을 정의합니다.</p>
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
            </article>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "organization"}>
            <div className="panel-head">
              <div>
                <h2>{copy.roleStatus}</h2>
                <p className="muted">역할을 비활성화하면 연결된 사용자는 다음 요청부터 즉시 차단됩니다.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>역할명</th>
                    <th>상태</th>
                    <th>권한 수</th>
                    <th>작업</th>
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

          <section className="panel split-panel" hidden={activeAdminMenu !== "service"}>
            <article>
              <div className="panel-head">
                <div>
                  <h2>{copy.verifyDomain}</h2>
                  <p className="muted">회사 도메인 기준 MX/SPF/DKIM/DMARC 안내를 고정된 응답 구조로 반환합니다.</p>
                </div>
              </div>
              <form className="compact-form" onSubmit={handleDomainVerify}>
                <label>
                  검증 도메인
                  <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
                </label>
                <button type="submit" disabled={loading}>{copy.verifyDomainAction}</button>
              </form>
              {domainResult && (
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
              )}
            </article>

            <article>
              <div className="panel-head">
                <div>
                  <h2>{copy.relayTest}</h2>
                  <p className="muted">단계 3에서는 local `mail-layer` 경로 성공 여부를 최소 1회 검증합니다.</p>
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
                <strong>현재 Relay</strong>
                <p>{overview.mailProvider.providerType}</p>
                <p className="muted">
                  {overview.mailProvider.relayHost}:{overview.mailProvider.relayPort}
                </p>
                <p>마지막 테스트: {overview.mailProvider.lastTestStatus}</p>
                <p className="muted">{overview.mailProvider.lastTestMessage}</p>
              </article>
              {relayResult && (
                <div className={`notice ${relayResult.status === "success" ? "success" : "warning"}`}>
                  <strong>{relayResult.status}</strong>
                  <p>{relayResult.message}</p>
                </div>
              )}
            </article>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "service"}>
            <div className="panel-head">
              <div>
                <h2>{copy.authContract}</h2>
                <p className="muted">user-web, desktop-client, mobile-app은 같은 로그인 응답 구조를 사용합니다.</p>
              </div>
            </div>
            <pre className="contract-block">{`POST /api/v1/auth/login
{
  "accessToken": "bearer-token",
  "tokenType": "bearer",
  "expiresIn": 3600,
  "user": {
    "userId": "user_xxx",
    "companyId": "company_xxx",
    "userName": "홍길동",
    "userEmail": "hong@company.com",
    "roleId": "role_xxx",
    "roleName": "일반사용자",
    "userType": "user",
    "status": "active",
    "permissions": ["mail:read", "approval:read", "profile:read"]
  }
}`}</pre>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "help"}>
            <div className="panel-head">
              <div>
                <h2>브랜드 / 메뉴 / 보관 정책 설정</h2>
                <p className="muted">관리자 웹은 운영 콘솔이자 회사별 커스터마이징과 정책 기준을 고정하는 화면이어야 합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>브랜드 설정</strong>
                <p>{overview.company.name} 기준 회사명, 로고, 대표 색상, 보조 색상, 버튼 스타일을 설정 대상으로 고정합니다.</p>
                <p className="muted">로그인 배경/문구, 상단 바, 사이드바, 조직 명칭까지 회사별 커스터마이징 범위에 포함합니다.</p>
              </article>
              <article className="status-card">
                <strong>메뉴 구성 설정</strong>
                <p>운영자는 메일, 결재, 메신저, 일정, 주소록, 조직도, 파일, 설정 메뉴의 노출 여부를 제어합니다.</p>
                <p className="muted">보관 정책은 메인 업무 카드가 아니라 Help, 정책 안내, 설정 &gt; 보관 정책으로 분리합니다.</p>
              </article>
              <article className="status-card">
                <strong>보관 정책 기본값</strong>
                <p>메일: 서버 1개월 + 설치형 로컬 아카이브 무기한</p>
                <p>메신저: 서버 2주 + 설치형 대화 파일(JSON/HTML) 보관</p>
              </article>
              <article className="status-card">
                <strong>다국어 메시지 범위</strong>
                <p>메뉴 번역뿐 아니라 에러, 검증, 경고, 성공, 상태, 알림, 세션 만료, 권한 없음, 차단 사유 문구를 포함합니다.</p>
                <p className="muted">메일/메신저 시스템 문구와 관리자 운영 경고 문구도 같은 메시지 계약으로 관리합니다.</p>
              </article>
            </div>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "brand"}>
            <div className="panel-head">
              <div>
                <h2>공통 브랜드 / 컴포넌트 기준</h2>
                <p className="muted">운영자는 색상값만 보는 것이 아니라, 그 색상이 실제 어떤 화면 요소와 상태 규칙에 연결되는지 이해해야 합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              {brandGuide.map((item) => (
                <article key={item.title} className="status-card">
                  <div style={{ width: "48px", height: "48px", borderRadius: "16px", background: item.value }} />
                  <strong style={{ display: "block", marginTop: "12px" }}>{item.title}</strong>
                  <p>{item.value}</p>
                  <p className="muted">{item.target}</p>
                </article>
              ))}
            </div>
            <div className="overview-grid" style={{ marginTop: "16px" }}>
              {componentGuide.map((item) => (
                <article key={item.title} className="status-card">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "brand"}>
            <div className="panel-head">
              <div>
                <h2>설정 편집 / 저장 / 반영 확인</h2>
                <p className="muted">운영자가 실제 값을 바꾸고 저장하면 user-web, mobile-app, desktop-client가 같은 계약을 읽는 구조를 고정합니다.</p>
              </div>
            </div>
            <div className="split-panel">
              <article>
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
                    <label>
                      빠른 작성 노출
                      <select value={uiContractDraft.quickComposeVisible ? "true" : "false"} onChange={(e) => setUiContractDraft((current) => ({ ...current, quickComposeVisible: e.target.value === "true" }))}>
                        <option value="true">표시</option>
                        <option value="false">숨김</option>
                      </select>
                    </label>
                    <label>
                      오류 메시지
                      <input value={uiContractDraft.messages.error} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, error: e.target.value } }))} />
                    </label>
                    <label>
                      경고 메시지
                      <input value={uiContractDraft.messages.warning} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, warning: e.target.value } }))} />
                    </label>
                    <label>
                      차단 메시지
                      <input value={uiContractDraft.messages.blocked} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, blocked: e.target.value } }))} />
                    </label>
                    <label>
                      빈 상태 메시지
                      <input value={uiContractDraft.messages.empty} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, empty: e.target.value } }))} />
                    </label>
                    <label>
                      성공 메시지
                      <input value={uiContractDraft.messages.success} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, success: e.target.value } }))} />
                    </label>
                    <label>
                      세션 만료 메시지
                      <input value={uiContractDraft.messages.sessionExpired} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, sessionExpired: e.target.value } }))} />
                    </label>
                    <label>
                      권한 없음 메시지
                      <input value={uiContractDraft.messages.permissionDenied} onChange={(e) => setUiContractDraft((current) => ({ ...current, messages: { ...current.messages, permissionDenied: e.target.value } }))} />
                    </label>
                  </div>
                  <div className="actions">
                    <button type="button" onClick={handleUiContractSave}>설정 저장</button>
                    <button type="button" className="secondary" onClick={() => void reloadUiContract()}>저장값 다시 불러오기</button>
                  </div>
                </form>
              </article>

              <article>
                <div className="status-card">
                  <strong>user-web 반영 요약</strong>
                  <p>상단 바 / 좌측 메뉴 / 빠른 작성 버튼 / 상태 박스 / Help 경로가 저장값 기준으로 반영됩니다.</p>
                  <p className="muted">빠른 작성: {uiContractDraft.quickComposeVisible ? "표시" : "숨김"} / 메뉴 순서: {uiContractDraft.menuOrder.join(" > ")}</p>
                </div>
                <div className="status-card">
                  <strong>mobile-app 반영 요약</strong>
                  <p>홈 카드 우선순위, 상태 메시지 문구, Help 경로가 같은 계약을 사용합니다.</p>
                  <p className="muted">홈 카드 우선순위: {uiContractDraft.homeCardOrder.join(" > ")}</p>
                </div>
                <div className="status-card">
                  <strong>desktop-client 반영 요약</strong>
                  <p>로컬 아카이브 / 대화 파일 저장 / 오프라인 보기 패널과 상태 메시지가 저장값 기준으로 반영됩니다.</p>
                  <p className="muted">정책 안내 문구: {uiContractDraft.helpText}</p>
                </div>
                <div className="status-card">
                  <strong>메시지 샘플</strong>
                  <p>오류: {uiContractDraft.messages.error}</p>
                  <p>경고: {uiContractDraft.messages.warning}</p>
                  <p>차단: {uiContractDraft.messages.blocked}</p>
                  <p>빈 상태: {uiContractDraft.messages.empty}</p>
                  <p>성공: {uiContractDraft.messages.success}</p>
                </div>
              </article>
            </div>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "brand"}>
            <div className="panel-head">
              <div>
                <h2>운영형 설정 계약</h2>
                <p className="muted">설정 화면에서 끝나는 것이 아니라, 운영자가 값 묶음과 실제 반영 위치를 같은 화면에서 확인할 수 있어야 합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              {settingsContracts.map((item) => (
                <article key={item.title} className="status-card">
                  <strong>{item.title}</strong>
                  <p>{item.values}</p>
                  <p className="muted">반영 대상: {item.targets}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel split-panel" hidden={activeAdminMenu !== "brand"}>
            <article>
              <div className="panel-head">
                <div>
                  <h2>회사별 미리보기 기준</h2>
                  <p className="muted">다음 구현 단계에서는 브랜드 설정 변경 결과를 관리자 화면에서 즉시 미리보게 해야 합니다.</p>
                </div>
              </div>
              <div className="status-card">
                <strong>{overview.company.name}</strong>
                <p>{overview.company.domain}</p>
                <p className="muted">대표 색상, 보조 색상, 버튼 스타일, 로그인 화면 문구/배경, 사이드바 스타일을 프리뷰 대상으로 고정합니다.</p>
              </div>
            </article>

            <article>
              <div className="panel-head">
                <div>
                  <h2>후속 구현 우선순위</h2>
                  <p className="muted">1단계 이후 실제 구현은 사용자용 화면부터 순차적으로 진행합니다.</p>
                </div>
              </div>
              <div className="status-card">
                <ol style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.9 }}>
                  <li>user-web 메인 업무 홈</li>
                  <li>admin-web 설정/브랜드/메뉴 구성</li>
                  <li>desktop-client 로컬 아카이브/대화 파일 흐름</li>
                  <li>mobile-app 빠른 확인 화면</li>
                </ol>
              </div>
            </article>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "brand"}>
            <div className="panel-head">
              <div>
                <h2>사용자 화면 반영 연결 보드</h2>
                <p className="muted">관리자 설정이 사용자 웹, 모바일, 설치형에 어떻게 연결되는지 운영자가 한 화면에서 이해할 수 있어야 합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              <article className="status-card">
                <strong>브랜드 설정 → user-web</strong>
                <p>로그인 화면 톤, 상단 바, 사이드바, 빠른 작성 버튼, 공지 카드, 메일/메신저 작업면 헤더에 반영</p>
                <p className="muted">운영자는 브랜드 색상 변경이 메일 폴더, 결재 배지, 메신저 타임라인 헤더 어디에 보이는지 바로 이해할 수 있어야 합니다.</p>
              </article>
              <article className="status-card">
                <strong>메뉴 구성 → mobile-app</strong>
                <p>홈/메일/결재/메신저 우선순위와 하단 이동 구조, 빠른 처리 카드 순서에 반영</p>
                <p className="muted">긴급 승인, 안 읽은 메일, 최근 대화 카드 노출 우선순위를 같은 설정 묶음으로 설명합니다.</p>
              </article>
              <article className="status-card">
                <strong>보관 정책 설정 → desktop-client</strong>
                <p>메일 로컬 아카이브, 대화 파일 저장 흐름, Help/설정 진입 문구, 오프라인 보기 패널에 반영</p>
                <p className="muted">설치형은 서버 정책 설명이 아니라 로컬 보관 진입 버튼과 경로 안내 문구에 연결됩니다.</p>
              </article>
              <article className="status-card">
                <strong>기본 언어 / 시간대</strong>
                <p>사용자 웹, 모바일, 설치형 로그인 직후 기본 표시 언어와 시간대에 공통 적용</p>
                <p className="muted">세션 만료, 차단, 오류, 빈 상태 메시지도 같은 언어 기준으로 노출됩니다.</p>
              </article>
            </div>
          </section>

          <section className="panel" hidden={activeAdminMenu !== "language"}>
            <div className="panel-head">
              <div>
                <h2>다국어 메시지 제어판</h2>
                <p className="muted">메뉴 번역만이 아니라 오류, 경고, 차단, 빈 상태, 성공 메시지까지 운영 대상이라는 점이 화면에서 보여야 합니다.</p>
              </div>
            </div>
            <div className="overview-grid">
              {[
                { title: "빈 상태 메시지", body: "표시할 데이터가 없습니다 / 아직 생성된 문서가 없습니다", target: "user-web 메일/결재 빈 화면" },
                { title: "오류 메시지", body: translationError || errors[0] || "요청 처리 중 오류가 발생했습니다.", target: "user-web / mobile-app API 오류" },
                { title: "차단 메시지", body: "권한이 없거나 세션이 만료되었습니다.", target: "mobile-app / desktop-client 세션 차단" },
                { title: "경고 메시지", body: warnings[0] || "설정값 검토가 필요합니다.", target: "admin-web 운영 경고, desktop-client 보관 경로 확인" },
                { title: "성공 메시지", body: message || "설정이 저장되었습니다.", target: "관리자 저장 완료, 사용자 처리 완료 알림" },
                { title: "세션 만료 메시지", body: "다시 로그인 후 업무를 계속하세요.", target: "모든 클라이언트 공통 세션 만료 안내" },
              ].map((item) => (
                <article key={item.title} className="status-card">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <p className="muted">대상: {item.target}</p>
                </article>
              ))}
            </div>
          </section>
          </section>
        </section>
      )}
    </main>
  );
}
