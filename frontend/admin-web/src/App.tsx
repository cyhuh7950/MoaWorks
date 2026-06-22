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
  updateTranslationPolicy,
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

  function resetAdminSession(nextMessage?: string) {
    clearToken();
    setToken("");
    setOverview(null);
    setMonitoringOverview(null);
    setMonitoringEvents([]);
    setApprovalAuditLogs([]);
    setTranslationPolicy(null);
    if (nextMessage) {
      setErrors([nextMessage]);
    }
  }

  async function refreshHealth() {
    const data = await fetchHealth();
    setHealth(data);
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
      setMessage(response.message);
      await refreshHealth();
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

      <section className="panel">
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

      <section className="panel">
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
        <>
          <section className="panel">
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

          <section className="panel">
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

          <section className="panel">
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

          <section className="panel split-panel">
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

          <section className="panel">
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

          <section className="panel split-panel">
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

          <section className="panel">
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
        </>
      )}
    </main>
  );
}
