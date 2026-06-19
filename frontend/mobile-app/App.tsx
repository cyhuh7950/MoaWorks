import React, { useEffect, useState } from "react";
import { Alert, Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type AuthUser = {
  userId: string;
  userName: string;
  roleName: string;
  userEmail: string;
  permissions: string[];
};

type AppLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-CN" | "es-ES" | "fr-FR" | "de-DE";

type LocaleText = {
  title: string;
  subtitle: string;
  apiBase: string;
  apiEndpoint: string;
  labelLanguage: string;
  labelTimezone: string;
  labelEmail: string;
  labelPassword: string;
  login: string;
  logout: string;
  notifications: string;
  unreadLabel: string;
  readAction: string;
  manualRefresh: string;
  retrying: string;
  noData: string;
  docsLabel: string;
};

const supportedLocales: AppLocale[] = ["ko-KR", "en-US", "ja-JP", "zh-CN", "es-ES", "fr-FR", "de-DE"];
const supportedTimezones = ["Asia/Seoul", "Asia/Tokyo", "America/New_York", "America/Chicago", "Europe/Paris", "Europe/Berlin"];

const localeDictionary: Record<AppLocale, LocaleText> = {
  "ko-KR": {
    title: "MoaWorks Mobile",
    subtitle: "결재/알림 업무 클라이언트",
    apiBase: "API Base",
    apiEndpoint: "공통 API",
    labelLanguage: "언어",
    labelTimezone: "시간대",
    labelEmail: "이메일",
    labelPassword: "비밀번호",
    login: "로그인",
    logout: "로그아웃",
    notifications: "알림",
    unreadLabel: "미읽음 {0} / 긴급 {1} / 경고 {2}",
    readAction: "읽음 처리",
    manualRefresh: "수동 재조회",
    retrying: "재시도 중...",
    noData: "데이터 없음",
    docsLabel: "사용자 계약 API",
  },
  "en-US": {
    title: "MoaWorks Mobile",
    subtitle: "Approval and notification client",
    apiBase: "API Base",
    apiEndpoint: "Common API",
    labelLanguage: "Language",
    labelTimezone: "Timezone",
    labelEmail: "Email",
    labelPassword: "Password",
    login: "Login",
    logout: "Logout",
    notifications: "Notifications",
    unreadLabel: "Unread {0} / Critical {1} / Warning {2}",
    readAction: "Mark Read",
    manualRefresh: "Manual refresh",
    retrying: "Retrying...",
    noData: "No data",
    docsLabel: "Public contract API",
  },
  "ja-JP": {
    title: "MoaWorks Mobile",
    subtitle: "承認・通知クライアント",
    apiBase: "API Base",
    apiEndpoint: "共通API",
    labelLanguage: "言語",
    labelTimezone: "タイムゾーン",
    labelEmail: "メール",
    labelPassword: "パスワード",
    login: "ログイン",
    logout: "ログアウト",
    notifications: "通知",
    unreadLabel: "未読 {0} / 重要 {1} / 警告 {2}",
    readAction: "既読",
    manualRefresh: "手動更新",
    retrying: "再試行中...",
    noData: "データなし",
    docsLabel: "共通契約API",
  },
  "zh-CN": {
    title: "MoaWorks Mobile",
    subtitle: "审批与通知客户端",
    apiBase: "API 地址",
    apiEndpoint: "公共 API",
    labelLanguage: "语言",
    labelTimezone: "时区",
    labelEmail: "邮箱",
    labelPassword: "密码",
    login: "登录",
    logout: "退出",
    notifications: "消息",
    unreadLabel: "未读 {0} / 紧急 {1} / 警告 {2}",
    readAction: "已读",
    manualRefresh: "手动刷新",
    retrying: "重试中...",
    noData: "暂无数据",
    docsLabel: "公共契约 API",
  },
  "es-ES": {
    title: "MoaWorks Mobile",
    subtitle: "Cliente de aprobación y notificaciones",
    apiBase: "API Base",
    apiEndpoint: "API común",
    labelLanguage: "Idioma",
    labelTimezone: "Zona horaria",
    labelEmail: "Correo",
    labelPassword: "Contraseña",
    login: "Iniciar sesión",
    logout: "Cerrar sesión",
    notifications: "Notificaciones",
    unreadLabel: "Sin leer {0} / Crítico {1} / Advertencia {2}",
    readAction: "Leído",
    manualRefresh: "Actualizar",
    retrying: "Reintentando...",
    noData: "Sin datos",
    docsLabel: "API contractual",
  },
  "fr-FR": {
    title: "MoaWorks Mobile",
    subtitle: "Client approbation/notifications",
    apiBase: "Base API",
    apiEndpoint: "API commune",
    labelLanguage: "Langue",
    labelTimezone: "Fuseau horaire",
    labelEmail: "Email",
    labelPassword: "Mot de passe",
    login: "Connexion",
    logout: "Déconnexion",
    notifications: "Notifications",
    unreadLabel: "Non lus {0} / Critique {1} / Avertissement {2}",
    readAction: "Lu",
    manualRefresh: "Actualiser",
    retrying: "Nouvel essai...",
    noData: "Aucune donnée",
    docsLabel: "API contractuelle",
  },
  "de-DE": {
    title: "MoaWorks Mobile",
    subtitle: "Freigabe- und Benachrichtigungs-Client",
    apiBase: "API Basis",
    apiEndpoint: "Gemeinsame API",
    labelLanguage: "Sprache",
    labelTimezone: "Zeitzone",
    labelEmail: "E-Mail",
    labelPassword: "Passwort",
    login: "Anmelden",
    logout: "Abmelden",
    notifications: "Benachrichtigungen",
    unreadLabel: "Ungelesen {0} / Kritisch {1} / Warnung {2}",
    readAction: "Als gelesen markieren",
    manualRefresh: "Aktualisieren",
    retrying: "Wiederholen...",
    noData: "Keine Daten",
    docsLabel: "Gemeinsame API",
  },
};

function resolveLocale(value: string | null): AppLocale {
  return supportedLocales.includes(value as AppLocale) ? (value as AppLocale) : "ko-KR";
}

function t(locale: AppLocale, key: keyof LocaleText, ...args: string[]): string {
  const template = localeDictionary[locale][key];
  if (args.length === 0) {
    return template;
  }
  return args.reduce((acc, item, index) => acc.replace(`{${index}}`, item), template);
}

type Approval = {
  id: string;
  title: string;
  content: string;
  creatorUserId: string;
  creatorUserName: string;
  status: string;
  submittedByUserId?: string;
  currentLineIndex?: number;
  lines?: { sequence: number; approverUserId: string; approverUserName: string; status: string }[];
};

const fallbackApiBase = "http://127.0.0.1:8010/api/v1";
const notificationPolicy = {
  retryMax: 3,
  retryDelayMs: 400,
} as const;

type NotificationRecord = {
  notificationId: string;
  category: "approval" | "mail" | "system";
  title: string;
  message: string;
  status: "unread" | "read" | "archived";
};

type NotificationSummary = {
  unreadCount: number;
  severityCount: {
    INFO: number;
    WARN: number;
    ERROR: number;
    CRITICAL: number;
  };
};

export default function App() {
  const [apiBase, setApiBase] = useState(fallbackApiBase);
  const [locale, setLocale] = useState<AppLocale>(resolveLocale("ko-KR"));
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("password1234");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [documents, setDocuments] = useState<Approval[]>([]);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [actionReason, setActionReason] = useState("동의");
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<NotificationSummary | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [notificationMode] = useState<"polling" | "fallback">("polling");
  const labels = localeDictionary[locale];

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const raw = await response.text();
    const data = raw ? (JSON.parse(raw) as T) : ({} as T);
    if (!response.ok) {
      const message = (data as { userMessage?: string }).userMessage || "요청 처리 실패";
      throw new Error(message);
    }
    return data;
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function withRetry<T>(task: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (attempt >= notificationPolicy.retryMax) {
        throw error;
      }
      await sleep(notificationPolicy.retryDelayMs * attempt);
      return withRetry(task, attempt + 1);
    }
  }

  async function loadNotifications(activeToken: string = token) {
    if (!activeToken) return;
    const [summary, body] = await Promise.all([
      request<NotificationSummary>("/notifications/summary", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }),
      request<{ notifications: NotificationRecord[] }>("/notifications?limit=20", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }),
    ]);
    setNotificationSummary(summary);
    setNotifications(body.notifications ?? []);
    setNotificationError("");
  }

  async function refreshNotifications() {
    try {
      await withRetry(() => loadNotifications());
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
    }
  }

  async function executeAckNotification(notificationId: string) {
    try {
      await request(`/notifications/${notificationId}/ack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshNotifications();
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "읽음 처리 실패");
    }
  }

  async function doLogin() {
    try {
      const login = await request<{ accessToken: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(login.accessToken);
      setMessage("로그인 성공");
      const meBody = await request<{ user: AuthUser }>("/auth/me", {
        headers: { Authorization: `Bearer ${login.accessToken}` },
      });
      setMe(meBody.user);
      await loadApprovals(login.accessToken);
      await loadNotifications(login.accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인 실패");
    }
  }

  async function loadApprovals(activeToken: string = token) {
    try {
      const body = await request<{ documents: Approval[] }>("/approvals", {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      setDocuments(body.documents);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "조회 실패");
    }
  }

  async function action(documentId: string, type: "submit" | "withdraw" | "redraft") {
    try {
      await request(`/approvals/${documentId}/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadApprovals();
    } catch (error) {
      Alert.alert("작업 실패", error instanceof Error ? error.message : "요청 실패");
    }
  }

  async function actionWithReason(documentId: string, type: "approve" | "reject") {
    try {
      await request(`/approvals/${documentId}/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: actionReason || "동의" }),
      });
      await loadApprovals();
    } catch (error) {
      Alert.alert("작업 실패", error instanceof Error ? error.message : "요청 실패");
    }
  }

  function can(permission: string) {
    return me?.permissions.includes(permission) ?? false;
  }

  function currentApprover(doc: Approval) {
    if (doc.currentLineIndex == null || !doc.lines) return null;
    return doc.lines.find((item) => item.sequence === doc.currentLineIndex);
  }

  useEffect(() => {
    if (token) {
      void loadApprovals();
    }
  }, [token]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{labels.title}</Text>
        <Text style={styles.desc}>{labels.subtitle}</Text>
        <Text style={styles.desc}>{labels.apiEndpoint}: {apiBase}/api/v1/approvals</Text>

        <Text style={styles.label}>{labels.labelLanguage}</Text>
        <TextInput
          style={styles.input}
          value={locale}
          onChangeText={(value) => setLocale(resolveLocale(value))}
          autoCapitalize="none"
        />
        <Text style={styles.label}>{labels.labelTimezone}</Text>
        <TextInput style={styles.input} value={timezone} onChangeText={setTimezone} autoCapitalize="none" />

        <Text style={styles.label}>API Base</Text>
        <TextInput style={styles.input} value={apiBase} onChangeText={setApiBase} />
        <Text style={styles.label}>이메일</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" />
        <Text style={styles.label}>비밀번호</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
        <Button title={labels.login} onPress={doLogin} />
        {me ? <Text style={styles.user}>{`${me.userName} (${me.roleName})`}</Text> : null}
        <Text style={styles.message}>{message}</Text>

        <Text style={styles.section}>{labels.notifications}</Text>
        {notificationSummary ? (
          <Text style={styles.muted}>
            {t(locale, "unreadLabel", String(notificationSummary.unreadCount), String(notificationSummary.severityCount.CRITICAL), String(notificationSummary.severityCount.WARN))}
          </Text>
        ) : (
          <Text style={styles.muted}>{labels.noData}</Text>
        )}
        <Text style={styles.muted}>
          {notificationMode === "polling" ? labels.manualRefresh : labels.manualRefresh} / {t(locale, "retrying")} ({notificationPolicy.retryMax})
        </Text>
        <Button title={labels.manualRefresh} onPress={() => {
          void refreshNotifications();
        }} />
        {notificationError ? <Text style={styles.error}>{notificationError}</Text> : null}
        {notifications.map((item) => (
          <View key={item.notificationId} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text>구분: {item.category}</Text>
            <Text>{item.message}</Text>
            <Text>상태: {item.status}</Text>
            <Button
              title={labels.readAction}
              disabled={item.status !== "unread"}
              onPress={() => {
                void executeAckNotification(item.notificationId);
              }}
            />
          </View>
        ))}
        {notifications.length === 0 ? <Text style={styles.muted}>{labels.noData}</Text> : null}
        {notificationError ? (
          <Button
            title={labels.manualRefresh}
            onPress={() => {
              void refreshNotifications();
            }}
          />
        ) : null}

        <Text style={styles.section}>결재 목록</Text>
        {documents.map((doc) => {
          const currentLine = currentApprover(doc);
          return (
            <View key={doc.id} style={styles.card}>
              <Text style={styles.cardTitle}>{doc.title}</Text>
              <Text>상태: {doc.status}</Text>
              <Text>작성자: {doc.creatorUserName}</Text>
              <Text>현재 결재: {currentLine ? `${currentLine.approverUserName} / ${currentLine.status}` : "-"}</Text>
              {doc.status === "draft" && doc.creatorUserId === me?.userId && can("approval:submit") ? (
                <Button title="상신" onPress={() => action(doc.id, "submit")} />
              ) : null}
              {doc.status === "submitted" && doc.creatorUserId === me?.userId && can("approval:withdraw") ? (
                <Button title="회수" onPress={() => action(doc.id, "withdraw")} />
              ) : null}
              {doc.status === "rejected" && doc.creatorUserId === me?.userId && can("approval:rework") ? (
                <Button title="재기안" onPress={() => action(doc.id, "redraft")} />
              ) : null}
              {doc.status === "submitted" &&
              can("approval:act") &&
              currentApprover(doc)?.approverUserId === me?.userId ? (
                <>
                  <Button title="승인" onPress={() => actionWithReason(doc.id, "approve")} />
                  <Button title="반려" onPress={() => actionWithReason(doc.id, "reject")} />
                </>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.label}>처리 사유</Text>
        <TextInput style={styles.input} value={actionReason} onChangeText={setActionReason} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f5f7f6",
  },
  container: {
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  desc: {
    color: "#64748b",
    marginBottom: 10,
  },
  label: {
    marginTop: 10,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cfd8e3",
    borderRadius: 8,
    padding: 8,
    backgroundColor: "white",
  },
  user: {
    marginTop: 8,
    fontWeight: "600",
  },
  message: {
    marginTop: 8,
    color: "#0f766e",
  },
  muted: {
    color: "#64748b",
  },
  error: {
    color: "#b91c1c",
  },
  section: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderColor: "#d5e0eb",
    borderRadius: 8,
    padding: 10,
    backgroundColor: "white",
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
});
