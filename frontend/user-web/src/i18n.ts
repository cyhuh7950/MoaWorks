export type AppLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-CN" | "es-ES" | "fr-FR" | "de-DE";

export type UiKey =
  | "appTitle"
  | "appSubtitle"
  | "notifications"
  | "notificationsMode"
  | "notificationSummary"
  | "notificationListEmpty"
  | "notificationError"
  | "currentUser"
  | "approvalCreate"
  | "approvalList"
  | "loginTitle"
  | "loginButton"
  | "email"
  | "password"
  | "commonRefresh"
  | "logout"
  | "approvalWrite"
  | "approve"
  | "reject"
  | "submit"
  | "withdraw"
  | "redraft"
  | "translationPolicy"
  | "translationSectionTitle"
  | "translationSourceText"
  | "translationTargetLocale"
  | "translate"
  | "translationResult"
  | "language"
  | "timezone"
  | "retry"
  | "manualRefresh";

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
    appTitle: "MoaWorks 사용자 웹",
    appSubtitle: "일반 사용자 업무용 클라이언트",
    notifications: "알림",
    notificationsMode: "수신 모드",
    notificationSummary: "알림 요약",
    notificationListEmpty: "알림이 없습니다.",
    notificationError: "알림 API 오류",
    currentUser: "현재 사용자",
    approvalCreate: "결재 작성",
    approvalWrite: "결재 작성",
    approvalList: "결재 목록",
    loginTitle: "로그인",
    loginButton: "로그인",
    email: "이메일",
    password: "비밀번호",
    commonRefresh: "새로고침",
    logout: "로그아웃",
    approve: "승인",
    reject: "반려",
    submit: "상신",
    withdraw: "회수",
    redraft: "재기안",
    translationPolicy: "번역 기능",
    translationSectionTitle: "번역 데모",
    translationSourceText: "원문",
    translationTargetLocale: "목표 언어",
    translate: "번역",
    translationResult: "번역 결과",
    language: "언어",
    timezone: "시간대",
    retry: "재시도",
    manualRefresh: "수동 재조회",
  },
  "en-US": {
    appTitle: "MoaWorks User Web",
    appSubtitle: "User workflow client",
    notifications: "Notifications",
    notificationsMode: "Receive mode",
    notificationSummary: "Notification summary",
    notificationListEmpty: "No notifications.",
    notificationError: "Notification API error",
    currentUser: "Current user",
    approvalCreate: "New approval",
    approvalWrite: "Create approval",
    approvalList: "Approvals",
    loginTitle: "Login",
    loginButton: "Login",
    email: "Email",
    password: "Password",
    commonRefresh: "Refresh",
    logout: "Logout",
    approve: "Approve",
    reject: "Reject",
    submit: "Submit",
    withdraw: "Withdraw",
    redraft: "Redraft",
    translationPolicy: "Translation",
    translationSectionTitle: "Translation demo",
    translationSourceText: "Source text",
    translationTargetLocale: "Target locale",
    translate: "Translate",
    translationResult: "Translated result",
    language: "Language",
    timezone: "Timezone",
    retry: "Retry",
    manualRefresh: "Manual refresh",
  },
  "ja-JP": {
    appTitle: "MoaWorks ユーザーWeb",
    appSubtitle: "一般ユーザー向け業務クライアント",
    notifications: "通知",
    notificationsMode: "受信モード",
    notificationSummary: "通知サマリー",
    notificationListEmpty: "通知はありません。",
    notificationError: "通知APIエラー",
    currentUser: "現在のユーザー",
    approvalCreate: "承認作成",
    approvalWrite: "承認作成",
    approvalList: "承認一覧",
    loginTitle: "ログイン",
    loginButton: "ログイン",
    email: "メール",
    password: "パスワード",
    commonRefresh: "更新",
    logout: "ログアウト",
    approve: "承認",
    reject: "却下",
    submit: "提出",
    withdraw: "取り消し",
    redraft: "差し戻し",
    translationPolicy: "翻訳",
    translationSectionTitle: "翻訳デモ",
    translationSourceText: "原文",
    translationTargetLocale: "対象言語",
    translate: "翻訳",
    translationResult: "翻訳結果",
    language: "言語",
    timezone: "タイムゾーン",
    retry: "再試行",
    manualRefresh: "手動更新",
  },
  "zh-CN": {
    appTitle: "MoaWorks 用户端",
    appSubtitle: "普通用户业务客户端",
    notifications: "消息",
    notificationsMode: "接收模式",
    notificationSummary: "消息汇总",
    notificationListEmpty: "暂无消息。",
    notificationError: "消息接口错误",
    currentUser: "当前用户",
    approvalCreate: "发起审批",
    approvalWrite: "发起审批",
    approvalList: "审批列表",
    loginTitle: "登录",
    loginButton: "登录",
    email: "邮箱",
    password: "密码",
    commonRefresh: "刷新",
    logout: "退出",
    approve: "同意",
    reject: "拒绝",
    submit: "提交",
    withdraw: "撤回",
    redraft: "重提",
    translationPolicy: "翻译",
    translationSectionTitle: "翻译预览",
    translationSourceText: "原文",
    translationTargetLocale: "目标语言",
    translate: "翻译",
    translationResult: "翻译结果",
    language: "语言",
    timezone: "时区",
    retry: "重试",
    manualRefresh: "手动刷新",
  },
  "es-ES": {
    appTitle: "MoaWorks Web de Usuario",
    appSubtitle: "Cliente de flujo de trabajo de usuario",
    notifications: "Notificaciones",
    notificationsMode: "Modo",
    notificationSummary: "Resumen",
    notificationListEmpty: "No hay notificaciones.",
    notificationError: "Error de API de notificaciones",
    currentUser: "Usuario actual",
    approvalCreate: "Crear aprobación",
    approvalWrite: "Crear aprobación",
    approvalList: "Lista de aprobación",
    loginTitle: "Iniciar sesión",
    loginButton: "Entrar",
    email: "Correo",
    password: "Contraseña",
    commonRefresh: "Actualizar",
    logout: "Cerrar sesión",
    approve: "Aprobar",
    reject: "Rechazar",
    submit: "Enviar",
    withdraw: "Retirar",
    redraft: "Reenviar",
    translationPolicy: "Traducción",
    translationSectionTitle: "Vista previa de traducción",
    translationSourceText: "Texto original",
    translationTargetLocale: "Idioma destino",
    translate: "Traducir",
    translationResult: "Resultado",
    language: "Idioma",
    timezone: "Zona horaria",
    retry: "Reintentar",
    manualRefresh: "Actualizar manual",
  },
  "fr-FR": {
    appTitle: "MoaWorks Web Utilisateur",
    appSubtitle: "Client de gestion utilisateur",
    notifications: "Notifications",
    notificationsMode: "Mode de réception",
    notificationSummary: "Résumé des notifications",
    notificationListEmpty: "Aucune notification.",
    notificationError: "Erreur API notification",
    currentUser: "Utilisateur actuel",
    approvalCreate: "Créer approbation",
    approvalWrite: "Créer approbation",
    approvalList: "Liste d'approbation",
    loginTitle: "Connexion",
    loginButton: "Connexion",
    email: "Email",
    password: "Mot de passe",
    commonRefresh: "Actualiser",
    logout: "Déconnexion",
    approve: "Approuver",
    reject: "Rejeter",
    submit: "Soumettre",
    withdraw: "Retirer",
    redraft: "Redemander",
    translationPolicy: "Traduction",
    translationSectionTitle: "Aperçu traduction",
    translationSourceText: "Texte source",
    translationTargetLocale: "Langue cible",
    translate: "Traduire",
    translationResult: "Résultat traduit",
    language: "Langue",
    timezone: "Fuseau horaire",
    retry: "Réessayer",
    manualRefresh: "Rafraîchir manuellement",
  },
  "de-DE": {
    appTitle: "MoaWorks Benutzerdashboard",
    appSubtitle: "Benutzerarbeit Client",
    notifications: "Benachrichtigungen",
    notificationsMode: "Empfangsmodus",
    notificationSummary: "Zusammenfassung",
    notificationListEmpty: "Keine Benachrichtigungen.",
    notificationError: "Benachrichtigungsfehler",
    currentUser: "Aktueller Benutzer",
    approvalCreate: "Freigabe erstellen",
    approvalWrite: "Freigabe erstellen",
    approvalList: "Freigabeliste",
    loginTitle: "Anmelden",
    loginButton: "Anmelden",
    email: "E-Mail",
    password: "Passwort",
    commonRefresh: "Aktualisieren",
    logout: "Abmelden",
    approve: "Genehmigen",
    reject: "Ablehnen",
    submit: "Einreichen",
    withdraw: "Zurückziehen",
    redraft: "Neuverfassen",
    translationPolicy: "Übersetzung",
    translationSectionTitle: "Vorschau",
    translationSourceText: "Quelltext",
    translationTargetLocale: "Zielsprache",
    translate: "Übersetzen",
    translationResult: "Übersetzungsergebnis",
    language: "Sprache",
    timezone: "Zeitzone",
    retry: "Wiederholen",
    manualRefresh: "Manuell aktualisieren",
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
  return dictionary[locale]?.[key] ?? dictionary[defaultLocale][key];
}
