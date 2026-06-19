export type AppLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-CN" | "es-ES" | "fr-FR" | "de-DE";

export type UiKey =
  | "appTitle"
  | "appDescription"
  | "systemStatus"
  | "apiBase"
  | "refresh"
  | "setupWizard"
  | "setupNotice"
  | "initializing"
  | "adminLogin"
  | "directoryPolicy"
  | "userManagement"
  | "department"
  | "role"
  | "create"
  | "logout"
  | "translationPolicy"
  | "translationDemoTitle"
  | "sourceText"
  | "targetLocale"
  | "translate"
  | "translationOff"
  | "translationResult"
  | "language"
  | "timezone"
  | "manual"
  | "success"
  | "error"
  | "retry"
  | "viewAll"
  | "noData"
  | "save";

export const supportedLocales: AppLocale[] = ["ko-KR", "en-US", "ja-JP", "zh-CN", "es-ES", "fr-FR", "de-DE"];

export const supportedTimezones = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "America/New_York",
  "America/Chicago",
  "Europe/Paris",
  "Europe/Berlin",
];

const dictionary: Record<AppLocale, Record<UiKey, string>> = {
  "ko-KR": {
    appTitle: "MoaWorks 관리자 플랫폼",
    appDescription: "운영자는 브라우저에서 초기 설치와 상태 점검을 끝낸다",
    systemStatus: "시스템 상태",
    apiBase: "API Base",
    refresh: "새로고침",
    setupWizard: "초기 설정 Wizard",
    setupNotice: "검증 통과 후에만 저장하도록 운영 흐름을 고정합니다.",
    initializing: "초기 설정이 이미 완료되었습니다.",
    adminLogin: "관리자 로그인",
    userManagement: "사용자 관리",
    directoryPolicy: "부서/권한/사용자 관리",
    department: "부서",
    role: "권한",
    create: "생성",
    logout: "로그아웃",
    translationPolicy: "번역 상태 / 정책",
    translationDemoTitle: "번역 미리보기 (원문/번역문 동시 보기)",
    sourceText: "원문 입력",
    targetLocale: "목표 언어",
    translate: "번역",
    translationOff: "번역이 비활성입니다.",
    translationResult: "번역 결과",
    language: "언어",
    timezone: "시간대",
    manual: "수동",
    success: "성공",
    error: "오류",
    retry: "재시도",
    viewAll: "전체 보기",
    noData: "데이터 없음",
    save: "저장",
  },
  "en-US": {
    appTitle: "MoaWorks Admin Platform",
    appDescription: "Complete initial setup and health checks from browser.",
    systemStatus: "System Status",
    apiBase: "API Base",
    refresh: "Refresh",
    setupWizard: "Initial Setup Wizard",
    setupNotice: "Only save after validation passes.",
    initializing: "Initial setup is already completed.",
    adminLogin: "Admin Login",
    userManagement: "User Management",
    directoryPolicy: "Directory / Permissions / Users",
    department: "Department",
    role: "Role",
    create: "Create",
    logout: "Logout",
    translationPolicy: "Translation status / policy",
    translationDemoTitle: "Translation preview (original + translated)",
    sourceText: "Source text",
    targetLocale: "Target locale",
    translate: "Translate",
    translationOff: "Translation is disabled.",
    translationResult: "Translated result",
    language: "Language",
    timezone: "Timezone",
    manual: "Manual",
    success: "Success",
    error: "Error",
    retry: "Retry",
    viewAll: "View all",
    noData: "No data",
    save: "Save",
  },
  "ja-JP": {
    appTitle: "MoaWorks 管理者プラットフォーム",
    appDescription: "ブラウザで初期セットアップと状態確認を実行します。",
    systemStatus: "システム状態",
    apiBase: "API ベース",
    refresh: "更新",
    setupWizard: "初期設定ウィザード",
    setupNotice: "検証に通過後のみ保存します。",
    initializing: "初期設定は完了しました。",
    adminLogin: "管理者ログイン",
    userManagement: "ユーザー管理",
    directoryPolicy: "部門・権限・ユーザー管理",
    department: "部門",
    role: "権限",
    create: "作成",
    logout: "ログアウト",
    translationPolicy: "翻訳ステータス / ポリシー",
    translationDemoTitle: "翻訳プレビュー（原文 / 訳文）",
    sourceText: "原文",
    targetLocale: "出力言語",
    translate: "翻訳",
    translationOff: "翻訳が無効です。",
    translationResult: "翻訳結果",
    language: "言語",
    timezone: "タイムゾーン",
    manual: "手動",
    success: "成功",
    error: "エラー",
    retry: "再試行",
    viewAll: "全部見る",
    noData: "データがありません",
    save: "保存",
  },
  "zh-CN": {
    appTitle: "MoaWorks 管理平台",
    appDescription: "在浏览器完成初始安装与状态检查。",
    systemStatus: "系统状态",
    apiBase: "API 地址",
    refresh: "刷新",
    setupWizard: "初始化向导",
    setupNotice: "仅在校验通过后保存。",
    initializing: "初始设置已完成。",
    adminLogin: "管理员登录",
    userManagement: "用户管理",
    directoryPolicy: "部门/权限/用户管理",
    department: "部门",
    role: "权限",
    create: "创建",
    logout: "退出",
    translationPolicy: "翻译状态/策略",
    translationDemoTitle: "翻译预览（原文/译文）",
    sourceText: "原文",
    targetLocale: "目标语言",
    translate: "翻译",
    translationOff: "翻译已停用。",
    translationResult: "翻译结果",
    language: "语言",
    timezone: "时区",
    manual: "手动",
    success: "成功",
    error: "错误",
    retry: "重试",
    viewAll: "查看全部",
    noData: "无数据",
    save: "保存",
  },
  "es-ES": {
    appTitle: "Plataforma de administración MoaWorks",
    appDescription: "Realiza la instalación inicial y verificación desde el navegador.",
    systemStatus: "Estado del sistema",
    apiBase: "API Base",
    refresh: "Actualizar",
    setupWizard: "Asistente de configuración",
    setupNotice: "Guardar solo después de pasar la validación.",
    initializing: "La configuración inicial ya está completa.",
    adminLogin: "Inicio de sesión de administrador",
    userManagement: "Gestión de usuarios",
    directoryPolicy: "Directorios / permisos / usuarios",
    department: "Departamento",
    role: "Rol",
    create: "Crear",
    logout: "Cerrar sesión",
    translationPolicy: "Estado/Política de traducción",
    translationDemoTitle: "Vista previa de traducción (original + traducida)",
    sourceText: "Texto original",
    targetLocale: "Idioma de destino",
    translate: "Traducir",
    translationOff: "La traducción está deshabilitada.",
    translationResult: "Resultado traducido",
    language: "Idioma",
    timezone: "Zona horaria",
    manual: "Manual",
    success: "Éxito",
    error: "Error",
    retry: "Reintentar",
    viewAll: "Ver todo",
    noData: "Sin datos",
    save: "Guardar",
  },
  "fr-FR": {
    appTitle: "Plateforme d'administration MoaWorks",
    appDescription: "Terminer l'installation initiale et la vérification depuis le navigateur.",
    systemStatus: "État du système",
    apiBase: "Base API",
    refresh: "Actualiser",
    setupWizard: "Assistant de configuration",
    setupNotice: "Enregistrer uniquement après validation.",
    initializing: "La configuration initiale est déjà terminée.",
    adminLogin: "Connexion administrateur",
    userManagement: "Gestion des utilisateurs",
    directoryPolicy: "Répertoire / droits / utilisateurs",
    department: "Département",
    role: "Rôle",
    create: "Créer",
    logout: "Déconnexion",
    translationPolicy: "État / politique de traduction",
    translationDemoTitle: "Prévisualisation (original + traduction)",
    sourceText: "Texte source",
    targetLocale: "Langue cible",
    translate: "Traduire",
    translationOff: "La traduction est désactivée.",
    translationResult: "Résultat de traduction",
    language: "Langue",
    timezone: "Fuseau horaire",
    manual: "Manuel",
    success: "Réussi",
    error: "Erreur",
    retry: "Réessayer",
    viewAll: "Voir tout",
    noData: "Aucune donnée",
    save: "Enregistrer",
  },
  "de-DE": {
    appTitle: "MoaWorks-Admin-Plattform",
    appDescription: "Führen Sie die Ersteinrichtung und Gesundheitsprüfung im Browser aus.",
    systemStatus: "Systemstatus",
    apiBase: "API-Quelle",
    refresh: "Aktualisieren",
    setupWizard: "Einrichtungsassistent",
    setupNotice: "Nur nach erfolgreicher Validierung speichern.",
    initializing: "Die Ersteinrichtung ist bereits abgeschlossen.",
    adminLogin: "Admin-Anmeldung",
    userManagement: "Benutzerverwaltung",
    directoryPolicy: "Verzeichnis / Rechte / Benutzer",
    department: "Abteilung",
    role: "Rolle",
    create: "Erstellen",
    logout: "Abmelden",
    translationPolicy: "Übersetzungsstatus/-richtlinie",
    translationDemoTitle: "Vorschau (Original + Übersetzung)",
    sourceText: "Quelltext",
    targetLocale: "Zielsprache",
    translate: "Übersetzen",
    translationOff: "Übersetzung ist deaktiviert.",
    translationResult: "Übersetzungsergebnis",
    language: "Sprache",
    timezone: "Zeitzone",
    manual: "Manuell",
    success: "Erfolgreich",
    error: "Fehler",
    retry: "Wiederholen",
    viewAll: "Alle anzeigen",
    noData: "Keine Daten",
    save: "Speichern",
  },
};

const defaultLocale: AppLocale = "ko-KR";

export function resolveLocale(storageValue: string | null): AppLocale {
  if (storageValue && supportedLocales.includes(storageValue as AppLocale)) {
    return storageValue as AppLocale;
  }
  return defaultLocale;
}

export function t(locale: AppLocale, key: UiKey): string {
  return dictionary[locale]?.[key] || dictionary[defaultLocale][key];
}
