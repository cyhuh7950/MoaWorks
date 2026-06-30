import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type AuthUser = {
  userId: string;
  userName: string;
  roleName: string;
  userEmail: string;
  permissions: string[];
};

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

type CreateApprovalPayload = {
  title: string;
  content: string;
  approverUserIds: string;
};

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

type MailSummary = {
  mailId: string;
  accountId: string;
  senderEmail: string;
  subject: string;
  status: string;
  isRead: boolean;
  isStarred: boolean;
  sentAt: string | null;
  receivedAt: string | null;
  retentionExpiresAt: string | null;
  attachmentCount: number;
};

type MailDetail = {
  mailId: string;
  accountId: string;
  senderUserId: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  retentionExpiresAt: string | null;
  attachmentCount: number;
  recipients: Array<{
    recipientEmail: string;
    recipientUserId: string | null;
    recipientKind: string;
    isRead: boolean;
    isStarred: boolean;
    receivedAt: string | null;
    readAt: string | null;
  }>;
};

type MessengerRoom = {
  roomId: string;
  roomType: string;
  roomName: string;
  participantIds: string[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  readState: string;
  createdAt: string;
  updatedAt: string;
  retentionExpiresAt: string | null;
};

type MessengerMessage = {
  messageId: string;
  roomId: string;
  senderUserId: string;
  senderUserName: string;
  messageType: string;
  body: string;
  attachmentMeta: Array<Record<string, unknown>>;
  createdAt: string;
  retentionExpiresAt: string | null;
  readBy: string[];
  readState: string;
};

type AppLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-CN" | "es-ES" | "fr-FR" | "de-DE";
type MobileTab = "home" | "mail" | "approval" | "chat";

const supportedLocales: AppLocale[] = ["ko-KR", "en-US", "ja-JP", "zh-CN", "es-ES", "fr-FR", "de-DE"];
const supportedTimezones = ["Asia/Seoul", "Asia/Tokyo", "America/New_York", "America/Chicago", "Europe/Paris", "Europe/Berlin"];
const fallbackApiBase = "https://api.moaworks.sinsan.kr/api/v1";
const notificationPolicy = {
  retryMax: 3,
  retryDelayMs: 400,
} as const;

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

const MAIL_POLICY = "메일 서버 1개월 / 설치형 로컬 아카이브 무기한";
const MESSENGER_POLICY = "메신저 서버 2주 / 설치형 대화 파일 보관";

function resolveLocale(value: string | null): AppLocale {
  return supportedLocales.includes(value as AppLocale) ? (value as AppLocale) : "ko-KR";
}

function formatStamp(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function App() {
  const passwordInputRef = useRef<TextInput | null>(null);
  const [apiBase, setApiBase] = useState(fallbackApiBase);
  const [locale, setLocale] = useState<AppLocale>(resolveLocale("ko-KR"));
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [documents, setDocuments] = useState<Approval[]>([]);
  const [createForm, setCreateForm] = useState<CreateApprovalPayload>({
    title: "",
    content: "",
    approverUserIds: "",
  });
  const [me, setMe] = useState<AuthUser | null>(null);
  const [actionReason, setActionReason] = useState("확인");
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<NotificationSummary | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [notificationMode] = useState<"polling" | "fallback">("polling");
  const [activeTab, setActiveTab] = useState<MobileTab>("home");
  const [uiContract, setUiContract] = useState<UiContract>(defaultUiContract);
  const [mailItems, setMailItems] = useState<MailSummary[]>([]);
  const [selectedMailId, setSelectedMailId] = useState("");
  const [selectedMailDetail, setSelectedMailDetail] = useState<MailDetail | null>(null);
  const [mailError, setMailError] = useState("");
  const [rooms, setRooms] = useState<MessengerRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [roomMessages, setRoomMessages] = useState<MessengerMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const activeTabError = activeTab === "mail" ? mailError : activeTab === "chat" ? chatError : "";

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
      const detail = (data as { detail?: { userMessage?: string } }).detail;
      const errorMessage = detail?.userMessage || (data as { userMessage?: string }).userMessage || "요청 처리 실패";
      throw new Error(errorMessage);
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
      await loadMail(login.accessToken);
      await loadRooms(login.accessToken);
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

  async function loadMail(activeToken: string = token, preferredMailId?: string) {
    if (!activeToken) return;
    try {
      const inbox = await request<{ mails: MailSummary[] }>("/mail/inbox", {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      const mails = inbox.mails ?? [];
      setMailItems(mails);
      const targetMailId = preferredMailId || selectedMailId || mails[0]?.mailId || "";
      if (targetMailId) {
        const detail = await request<MailDetail>(`/mail/${targetMailId}`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        setSelectedMailId(targetMailId);
        setSelectedMailDetail(detail);
      } else {
        setSelectedMailId("");
        setSelectedMailDetail(null);
      }
      setMailError("");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "메일 조회 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function openMail(mailId: string, activeToken: string = token) {
    if (!activeToken) return;
    try {
      await request(`/mail/${mailId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      const detail = await request<MailDetail>(`/mail/${mailId}`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      setSelectedMailId(mailId);
      setSelectedMailDetail(detail);
      setMailItems((current) => current.map((item) => (item.mailId === mailId ? { ...item, isRead: true } : item)));
      setMailError("");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "메일 상세 조회 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function toggleMailStarState(mailId: string, activeToken: string = token) {
    if (!activeToken) return;
    try {
      await request(`/mail/${mailId}/star`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      await loadMail(activeToken, mailId);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "중요 표시 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function loadRooms(activeToken: string = token, preferredRoomId?: string) {
    if (!activeToken) return;
    try {
      const body = await request<{ rooms: MessengerRoom[] }>("/messenger/rooms", {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      const nextRooms = body.rooms ?? [];
      setRooms(nextRooms);
      const roomId = preferredRoomId || selectedRoomId || nextRooms[0]?.roomId || "";
      if (roomId) {
        const messages = await request<{ messages: MessengerMessage[] }>(`/messenger/rooms/${roomId}/messages`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        setSelectedRoomId(roomId);
        setRoomMessages(messages.messages ?? []);
      } else {
        setSelectedRoomId("");
        setRoomMessages([]);
      }
      setChatError("");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "메신저 조회 실패";
      setChatError(nextError);
      setMessage(nextError);
    }
  }

  async function openRoom(roomId: string, activeToken: string = token) {
    if (!activeToken) return;
    try {
      await request(`/messenger/rooms/${roomId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      const messages = await request<{ messages: MessengerMessage[] }>(`/messenger/rooms/${roomId}/messages`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      setSelectedRoomId(roomId);
      setRoomMessages(messages.messages ?? []);
      setRooms((current) => current.map((item) => (item.roomId === roomId ? { ...item, unreadCount: 0 } : item)));
      setChatError("");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "대화방 조회 실패";
      setChatError(nextError);
      setMessage(nextError);
    }
  }

  async function sendChatMessage() {
    if (!token || !selectedRoomId || !chatDraft.trim()) return;
    try {
      await request(`/messenger/rooms/${selectedRoomId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: chatDraft.trim(), messageType: "text", attachmentMeta: [] }),
      });
      setChatDraft("");
      await openRoom(selectedRoomId);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "메시지 전송 실패";
      setChatError(nextError);
      setMessage(nextError);
    }
  }

  function handleTabPress(nextTab: MobileTab) {
    setActiveTab(nextTab);
    if (!token) return;
    if (nextTab === "mail") {
      void loadMail(token);
      return;
    }
    if (nextTab === "chat") {
      void loadRooms(token);
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
        body: JSON.stringify({ reason: actionReason || "확인" }),
      });
      await loadApprovals();
    } catch (error) {
      Alert.alert("작업 실패", error instanceof Error ? error.message : "요청 실패");
    }
  }

  function can(permission: string) {
    return me?.permissions.includes(permission) ?? false;
  }

  async function createApprovalDocument() {
    try {
      await request("/approvals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: createForm.title,
          content: createForm.content,
          approverUserIds: createForm.approverUserIds.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      setCreateForm({ title: "", content: "", approverUserIds: "" });
      await loadApprovals();
    } catch (error) {
      Alert.alert("작성 실패", error instanceof Error ? error.message : "요청 실패");
    }
  }

  function currentApprover(doc: Approval) {
    if (doc.currentLineIndex == null || !doc.lines) return null;
    return doc.lines.find((item) => item.sequence === doc.currentLineIndex);
  }

  const summaryCards = useMemo(
    () => [
      {
        title: "알림",
        value: `${notificationSummary?.unreadCount ?? 0}건`,
        desc: "세션 만료, 승인 요청, 시스템 경고를 가장 먼저 확인",
        tone: styles.cardDark,
      },
      {
        title: "결재",
        value: `${documents.filter((item) => item.status === "submitted").length}건`,
        desc: "대기 결재와 상신 흐름을 모바일 메인에서 바로 진입",
        tone: styles.cardTeal,
      },
      {
        title: "최근 대화",
        value: `${rooms.length}개`,
        desc: "상세 보관은 설치형, 모바일은 최근 대화와 알림 확인 중심",
        tone: styles.cardSand,
      },
      {
        title: "오늘 일정",
        value: "다음 단계",
        desc: "오늘 일정과 공지를 모바일 홈의 1차 진입 카드로 고정",
        tone: styles.cardRose,
      },
    ],
    [documents, notificationSummary, rooms.length],
  );

  useEffect(() => {
    if (token) {
      void loadApprovals();
      void loadMail();
      void loadRooms();
    }
  }, [token]);

  useEffect(() => {
    void request<UiContract>("/ui-contract")
      .then((contract) => setUiContract({ ...defaultUiContract, ...contract }))
      .catch(() => setUiContract(defaultUiContract));
  }, [apiBase]);

  const urgentApprovals = documents.filter((item) => item.status === "submitted").slice(0, 3);
  const quickReplySamples = ["답장", "중요", "나중에 보기"];
  const recentApprovalActions = ["긴급 승인", "반려 사유 입력", "회수 요청 확인"];
  const sessionMessages = [
    uiContract.messages.sessionExpired,
    uiContract.messages.permissionDenied,
    uiContract.messages.error,
  ];
  const brandTokens = [
    { title: "대표", color: "#0f766e", body: "주요 버튼, 활성 탭, 승인 흐름" },
    { title: "보조", color: "#111827", body: "기본 헤더, 문서 제목, 제품 공통 톤" },
    { title: "강조", color: "#9a6b2f", body: "메일/메신저 보조 카드, 안내 포인트" },
    { title: "차단", color: "#9f1239", body: "긴급, 차단, 가장 강한 제한 상태" },
  ];
  const statusSignals = [
    { title: "성공", body: "처리 완료, 저장 완료", tone: styles.quickTeal },
    { title: "정보", body: "정책 경로, 기본 안내", tone: styles.quickInk },
    { title: "경고", body: "재검토 필요, 확인 안내", tone: styles.quickSand },
    { title: "오류/차단", body: "요청 실패, 세션 만료, 권한 없음", tone: styles.quickDanger },
  ];
  const mobileContracts = [
    { title: "홈 카드 우선순위", body: "긴급 알림, 승인 대기, 최근 대화 순서를 같은 계약으로 유지합니다." },
    { title: "상태 메시지", body: "오류, 차단, 세션 만료 문구를 다른 클라이언트와 같은 기준으로 보여줍니다." },
    { title: "정책 안내 경로", body: `${uiContract.helpText} 경로만 공통으로 유지합니다.` },
  ];
  const homeQuickCards = [
    { id: "alerts", title: "긴급 알림", note: `${notificationSummary?.severityCount.CRITICAL ?? 0}건`, tone: styles.quickDanger },
    { id: "approval", title: "승인 대기", note: `${urgentApprovals.length}건`, tone: styles.quickTeal },
    { id: "chat", title: "최근 대화", note: `${rooms.length}개 대화방`, tone: styles.quickSand },
    { id: "mail", title: "안 읽은 메일", note: `${mailItems.filter((item) => !item.isRead).length}건`, tone: styles.quickInk },
  ].sort((left, right) => {
    const leftIndex = uiContract.homeCardOrder.indexOf(left.id);
    const rightIndex = uiContract.homeCardOrder.indexOf(right.id);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>MoaWorks Mobile</Text>
          <Text style={styles.heroTitle}>사용자 업무 포털 모바일 메인</Text>
          <Text style={styles.heroDesc}>
            알림, 결재, 메일, 최근 대화를 빠르게 확인하는 모바일 업무 화면입니다.
          </Text>

          {!me ? (
            <>
              <Text style={styles.sectionLabel}>이메일</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="email-address"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordInputRef.current?.focus()}
              />
              <Text style={styles.sectionLabel}>비밀번호</Text>
              <TextInput
                ref={passwordInputRef}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="done"
                onSubmitEditing={() => {
                  void doLogin();
                }}
              />
              <View style={styles.buttonBlock}>
                <Button title="업무 포털 로그인" onPress={doLogin} />
              </View>
            </>
          ) : (
            <View style={styles.loggedInHeroCard}>
              <Text style={styles.loggedInHeroTitle}>업무 포털 접속 완료</Text>
              <Text style={styles.userName}>{`${me.userName} (${me.roleName})`}</Text>
              <Text style={styles.loggedInHeroText}>{me.userEmail}</Text>
              <Text style={styles.loggedInHeroText}>
                알림 {notificationSummary?.unreadCount ?? 0}건 / 대기 결재 {documents.filter((item) => item.status === "submitted").length}건
              </Text>
            </View>
          )}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>

        {me ? (
          <>
            <View style={styles.metricsGrid}>
              {summaryCards.map((item) => (
                <View key={item.title} style={[styles.metricCard, item.tone]}>
                  <Text style={styles.metricLabel}>{item.title}</Text>
                  <Text style={styles.metricValue}>{item.value}</Text>
                  <Text style={styles.metricDesc}>{item.desc}</Text>
                </View>
              ))}
            </View>

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>빠른 이동</Text>
              <Text style={styles.surfaceTitle}>모바일 주요 업무 탭</Text>
              <View style={styles.mobileTabRow}>
                {[
                  { id: "home", label: "홈" },
                  { id: "mail", label: "메일" },
                  { id: "approval", label: "결재" },
                  { id: "chat", label: "메신저" },
                ].map((item) => (
                  <Text
                    key={item.id}
                    onPress={() => handleTabPress(item.id as MobileTab)}
                    style={[styles.mobileTab, activeTab === item.id ? styles.mobileTabActive : styles.mobileTabIdle]}
                  >
                    {item.label}
                  </Text>
                ))}
              </View>
              <Text style={styles.surfaceHint}>정책 본문은 메인에 두지 않고 {uiContract.helpText} 경로만 제공합니다.</Text>
              {activeTabError ? <Text style={styles.error}>{activeTabError}</Text> : null}
            </View>

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>공통 기준</Text>
              <Text style={styles.surfaceTitle}>브랜드 / 상태 / Help 경로</Text>
              <View style={styles.quickGrid}>
                {brandTokens.map((item) => (
                  <View key={item.title} style={styles.listCard}>
                    <View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: item.color }} />
                    <Text style={styles.listKicker}>{item.title}</Text>
                    <Text style={styles.listBody}>{item.body}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.quickGrid}>
                {statusSignals.map((item) => (
                  <View key={item.title} style={[styles.quickCard, item.tone]}>
                    <Text style={styles.quickCardTitle}>{item.title}</Text>
                    <Text style={styles.quickCardNote}>{item.body}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.quickGrid}>
                {mobileContracts.map((item) => (
                  <View key={item.title} style={styles.listCard}>
                    <Text style={styles.listKicker}>{item.title}</Text>
                    <Text style={styles.listBody}>{item.body}</Text>
                  </View>
                ))}
              </View>
            </View>

            {activeTab === "home" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>홈</Text>
                <Text style={styles.surfaceTitle}>알림 / 대기 결재 / 최근 대화 / 오늘 일정</Text>
                <View style={styles.quickGrid}>
                  {homeQuickCards.map((item) => (
                    <View key={item.title} style={[styles.quickCard, item.tone]}>
                      <Text style={styles.quickCardTitle}>{item.title}</Text>
                      <Text style={styles.quickCardNote}>{item.note}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {activeTab === "mail" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>메일</Text>
                <Text style={styles.surfaceTitle}>중요 메일 / 안 읽은 메일 / 빠른 답장</Text>
                <View style={styles.quickGrid}>
                  {[
                    { title: "중요 메일", note: "대표 검토 요청 우선", tone: styles.quickSand },
                    { title: "안 읽은 메일", note: `${mailItems.filter((item) => !item.isRead).length}건`, tone: styles.quickTeal },
                  ].map((item) => (
                    <View key={item.title} style={[styles.quickCard, item.tone]}>
                      <Text style={styles.quickCardTitle}>{item.title}</Text>
                      <Text style={styles.quickCardNote}>{item.note}</Text>
                    </View>
                  ))}
                </View>
                {mailItems.map((item) => (
                  <View key={item.mailId} style={styles.listCard}>
                    <Text style={styles.listKicker}>중요 메일</Text>
                    <Text style={styles.listTitle}>{item.subject}</Text>
                    <Text style={styles.listBody}>{item.senderEmail} · {formatStamp(item.receivedAt || item.sentAt)}</Text>
                    <View style={styles.mobileTabRow}>
                      <Text onPress={() => { void openMail(item.mailId); }} style={[styles.mobileTab, styles.mobileTabIdle]}>열기</Text>
                      <Text onPress={() => { void toggleMailStarState(item.mailId); }} style={[styles.mobileTab, styles.mobileTabIdle]}>
                        {item.isStarred ? "중요 해제" : "중요"}
                      </Text>
                      {quickReplySamples.map((action) => <Text key={`${item.mailId}-${action}`} style={[styles.mobileTab, styles.mobileTabIdle]}>{action}</Text>)}
                    </View>
                  </View>
                ))}
                {selectedMailDetail ? (
                  <View style={styles.listCard}>
                    <Text style={styles.listKicker}>메일 상세</Text>
                    <Text style={styles.listTitle}>{selectedMailDetail.subject}</Text>
                    <Text style={styles.listBody}>{selectedMailDetail.bodyText}</Text>
                    <Text style={styles.listBody}>수신: {selectedMailDetail.recipients.map((item) => item.recipientEmail).join(", ") || "-"}</Text>
                  </View>
                ) : null}
                {mailError ? <Text style={styles.error}>{mailError}</Text> : null}
                <Text style={styles.emptyState}>장기 보관 메일은 설치형 로컬 아카이브 흐름으로 연결됩니다.</Text>
              </View>
            ) : null}

            {activeTab === "approval" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>결재</Text>
                <Text style={styles.surfaceTitle}>긴급 승인 / 대기 문서 / 최근 처리</Text>
                <View style={styles.quickGrid}>
                  {recentApprovalActions.map((item, index) => (
                    <View key={item} style={[styles.quickCard, index === 0 ? styles.quickDanger : styles.quickInk]}>
                      <Text style={styles.quickCardTitle}>{item}</Text>
                      <Text style={styles.quickCardNote}>모바일에서 바로 실행할 수 있는 1차 처리 흐름</Text>
                    </View>
                  ))}
                </View>
                {urgentApprovals.length === 0 ? <Text style={styles.emptyState}>승인 대기 문서가 없습니다.</Text> : null}
                {urgentApprovals.map((doc) => (
                  <View key={doc.id} style={styles.listCard}>
                    <Text style={styles.listKicker}>{doc.status}</Text>
                    <Text style={styles.listTitle}>{doc.title}</Text>
                    <Text style={styles.listBody}>긴급 문서는 모바일에서 즉시 승인/반려/회수 흐름으로 이동합니다.</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {activeTab === "chat" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>메신저</Text>
                <Text style={styles.surfaceTitle}>최근 대화 / 고정 채널 / 미확인 메시지</Text>
                <View style={styles.quickGrid}>
                  {[
                    { title: "최근 대화", note: `${rooms.length}개`, tone: styles.quickInk },
                    { title: "고정 채널", note: rooms[0]?.roomName || "대화방 없음", tone: styles.quickSand },
                    { title: "미확인 메시지", note: `${rooms.reduce((sum, item) => sum + item.unreadCount, 0)}건`, tone: styles.quickDanger },
                  ].map((item) => (
                    <View key={item.title} style={[styles.quickCard, item.tone]}>
                      <Text style={styles.quickCardTitle}>{item.title}</Text>
                      <Text style={styles.quickCardNote}>{item.note}</Text>
                    </View>
                  ))}
                </View>
                {rooms.map((item) => (
                  <View key={item.roomId} style={styles.listCard}>
                    <Text style={styles.listKicker}>최근 대화</Text>
                    <Text style={styles.listTitle}>{item.roomName}</Text>
                    <Text style={styles.listBody}>{item.lastMessage || "최근 메시지 없음"} / 미읽음 {item.unreadCount}</Text>
                    <View style={styles.mobileTabRow}>
                      <Text onPress={() => { void openRoom(item.roomId); }} style={[styles.mobileTab, styles.mobileTabIdle]}>열기</Text>
                    </View>
                  </View>
                ))}
                {roomMessages.map((item) => (
                  <View key={item.messageId} style={styles.listCard}>
                    <Text style={styles.listKicker}>{item.senderUserName}</Text>
                    <Text style={styles.listTitle}>{formatStamp(item.createdAt)}</Text>
                    <Text style={styles.listBody}>{item.body}</Text>
                  </View>
                ))}
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={chatDraft}
                  onChangeText={setChatDraft}
                  placeholder="메시지를 입력하세요."
                  multiline
                />
                <View style={styles.buttonBlock}>
                  <Button title="메시지 전송" onPress={() => { void sendChatMessage(); }} />
                </View>
                {chatError ? <Text style={styles.error}>{chatError}</Text> : null}
              </View>
            ) : null}

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>알림</Text>
              <Text style={styles.surfaceTitle}>빠른 확인과 폴백</Text>
              <Text style={styles.surfaceHint}>
                수신 모드: {notificationMode === "polling" ? "Polling" : "Fallback"} / 미읽음 {notificationSummary?.unreadCount ?? 0} / 긴급 {notificationSummary?.severityCount.CRITICAL ?? 0}
              </Text>
              <View style={styles.inlineButtons}>
                <Button title="알림 새로고침" onPress={() => { void refreshNotifications(); }} />
              </View>
              {notificationError ? <Text style={styles.error}>{notificationError || uiContract.messages.error}</Text> : null}
              {notifications.map((item) => (
                <View key={item.notificationId} style={styles.listCard}>
                  <View style={styles.listHeader}>
                    <View>
                      <Text style={styles.listKicker}>{item.category}</Text>
                      <Text style={styles.listTitle}>{item.title}</Text>
                    </View>
                    <View style={[styles.statusPill, item.status === "unread" ? styles.statusUnread : styles.statusRead]}>
                      <Text style={[styles.statusPillText, item.status === "unread" ? styles.statusUnreadText : styles.statusReadText]}>{item.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.listBody}>{item.message}</Text>
                  <Button
                    title="읽음 처리"
                    disabled={item.status !== "unread"}
                    onPress={() => {
                      void executeAckNotification(item.notificationId);
                    }}
                  />
                </View>
              ))}
              {notifications.length === 0 ? <Text style={styles.emptyState}>아직 표시할 알림이 없습니다.</Text> : null}
            </View>

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>현재 사용자</Text>
              <Text style={styles.surfaceTitle}>프로필 / 역할 / 업무 권한</Text>
              <View style={styles.profileCard}>
                <Text style={styles.profileName}>{me?.userName || "로그인 후 표시"}</Text>
                <Text style={styles.profileText}>{me?.roleName || "역할 미지정"}</Text>
                <Text style={styles.profileText}>{me?.userEmail || "이메일 미확인"}</Text>
                <Text style={styles.profileText}>결재 작성 권한: {can("approval:create") ? "있음" : "없음"}</Text>
              </View>
              <View style={styles.policyCard}>
                {sessionMessages.map((item) => (
                  <Text key={item} style={styles.policyText}>{item}</Text>
                ))}
              </View>
            </View>

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>설정 / Help</Text>
              <Text style={styles.surfaceTitle}>정책 경로와 세션 정리</Text>
              <View style={styles.policyCard}>
                <Text style={styles.policyText}>정책 확인 경로: {uiContract.helpText}</Text>
                <Text style={styles.policyText}>언어, 시간대, 알림 새로고침 기준은 공통 설정 계약을 따릅니다.</Text>
              </View>
              <View style={styles.buttonBlock}>
                <Button
                  title="로그아웃"
                  onPress={() => {
                    setToken("");
                    setMe(null);
                    setMessage("로그아웃되었습니다.");
                    setSelectedMailDetail(null);
                    setSelectedRoom(null);
                    setSelectedRoomMessages([]);
                  }}
                />
              </View>
            </View>

            {can("approval:create") ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>결재 작성</Text>
                <Text style={styles.surfaceTitle}>모바일 빠른 상신</Text>
                <Text style={styles.sectionLabel}>제목</Text>
                <TextInput
                  style={styles.input}
                  value={createForm.title}
                  onChangeText={(value) => setCreateForm((current) => ({ ...current, title: value }))}
                />
                <Text style={styles.sectionLabel}>내용</Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={createForm.content}
                  onChangeText={(value) => setCreateForm((current) => ({ ...current, content: value }))}
                  multiline
                />
                <Text style={styles.sectionLabel}>결재자 사용자ID (콤마 구분)</Text>
                <TextInput
                  style={styles.input}
                  value={createForm.approverUserIds}
                  onChangeText={(value) => setCreateForm((current) => ({ ...current, approverUserIds: value }))}
                  autoCapitalize="none"
                />
                <View style={styles.buttonBlock}>
                  <Button title="결재 초안 저장" onPress={() => { void createApprovalDocument(); }} />
                </View>
              </View>
            ) : null}

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>결재 목록</Text>
              <Text style={styles.surfaceTitle}>상태별 문서 보기</Text>
              {documents.map((doc) => {
                const currentLine = currentApprover(doc);
                return (
                  <View key={doc.id} style={styles.listCard}>
                    <View style={styles.listHeader}>
                      <View>
                        <Text style={styles.listKicker}>{doc.status}</Text>
                        <Text style={styles.listTitle}>{doc.title}</Text>
                      </View>
                      <View style={[styles.statusPill, styles.statusApproval]}>
                        <Text style={[styles.statusPillText, styles.statusApprovalText]}>{doc.creatorUserName}</Text>
                      </View>
                    </View>
                    <Text style={styles.listBody}>
                      현재 결재선: {currentLine ? `${currentLine.approverUserName} / ${currentLine.status}` : "대기 없음"}
                    </Text>
                    {doc.status === "draft" && doc.creatorUserId === me?.userId && can("approval:submit") ? (
                      <View style={styles.buttonBlock}>
                        <Button title="상신" onPress={() => action(doc.id, "submit")} />
                      </View>
                    ) : null}
                    {doc.status === "submitted" && doc.creatorUserId === me?.userId && can("approval:withdraw") ? (
                      <View style={styles.buttonBlock}>
                        <Button title="회수" onPress={() => action(doc.id, "withdraw")} />
                      </View>
                    ) : null}
                    {doc.status === "rejected" && doc.creatorUserId === me?.userId && can("approval:rework") ? (
                      <View style={styles.buttonBlock}>
                        <Button title="재기안" onPress={() => action(doc.id, "redraft")} />
                      </View>
                    ) : null}
                    {doc.status === "submitted" && can("approval:act") && currentApprover(doc)?.approverUserId === me?.userId ? (
                      <>
                        <Text style={styles.sectionLabel}>처리 사유</Text>
                        <TextInput style={styles.input} value={actionReason} onChangeText={setActionReason} />
                        <View style={styles.buttonPair}>
                          <View style={styles.buttonHalf}><Button title="승인" onPress={() => actionWithReason(doc.id, "approve")} /></View>
                          <View style={styles.buttonHalf}><Button title="반려" color="#9f1239" onPress={() => actionWithReason(doc.id, "reject")} /></View>
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
              {documents.length === 0 ? <Text style={styles.emptyState}>아직 문서가 없습니다.</Text> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#eef4f3",
  },
  container: {
    padding: 18,
    gap: 18,
  },
  hero: {
    borderRadius: 30,
    padding: 22,
    backgroundColor: "#0f172a",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroKicker: {
    color: "#67e8f9",
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  heroTitle: {
    marginTop: 12,
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 34,
  },
  heroDesc: {
    marginTop: 12,
    color: "rgba(248,250,252,0.78)",
    lineHeight: 22,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chipText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionLabel: {
    marginTop: 14,
    fontWeight: "700",
    color: "#dbeafe",
  },
  input: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0f172a",
  },
  buttonBlock: {
    marginTop: 16,
  },
  userName: {
    marginTop: 12,
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  message: {
    marginTop: 12,
    color: "#99f6e4",
    lineHeight: 20,
  },
  loggedInHeroCard: {
    marginTop: 18,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 8,
  },
  loggedInHeroTitle: {
    color: "#67e8f9",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  loggedInHeroText: {
    color: "rgba(248,250,252,0.82)",
    lineHeight: 20,
  },
  metricsGrid: {
    gap: 14,
  },
  mobileTabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  mobileTab: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontWeight: "800",
    overflow: "hidden",
  },
  mobileTabActive: {
    backgroundColor: "#0f766e",
    color: "#ffffff",
  },
  mobileTabIdle: {
    backgroundColor: "#f8fafc",
    color: "#334155",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  quickGrid: {
    marginTop: 16,
    gap: 12,
  },
  quickCard: {
    borderRadius: 20,
    padding: 18,
  },
  quickDanger: {
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3",
  },
  quickTeal: {
    backgroundColor: "#ecfeff",
    borderWidth: 1,
    borderColor: "#99f6e4",
  },
  quickSand: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  quickInk: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  quickCardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  quickCardNote: {
    marginTop: 8,
    color: "#475569",
    lineHeight: 21,
  },
  metricCard: {
    borderRadius: 24,
    padding: 20,
    minHeight: 156,
  },
  cardDark: {
    backgroundColor: "#111827",
  },
  cardTeal: {
    backgroundColor: "#0f766e",
  },
  cardSand: {
    backgroundColor: "#9a6b2f",
  },
  cardRose: {
    backgroundColor: "#9f1239",
  },
  metricLabel: {
    color: "rgba(248,250,252,0.76)",
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  metricValue: {
    marginTop: 16,
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
  },
  metricDesc: {
    marginTop: 14,
    color: "rgba(248,250,252,0.88)",
    lineHeight: 21,
  },
  surfaceCard: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#dce5ec",
    padding: 22,
  },
  surfaceKicker: {
    color: "#0f766e",
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  surfaceTitle: {
    marginTop: 10,
    fontSize: 26,
    fontWeight: "800",
    color: "#0f172a",
  },
  surfaceHint: {
    marginTop: 12,
    color: "#64748b",
    lineHeight: 21,
  },
  policyCard: {
    marginTop: 14,
    borderRadius: 20,
    padding: 18,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  policyTitle: {
    fontWeight: "800",
    color: "#0f172a",
    fontSize: 16,
  },
  policyText: {
    marginTop: 8,
    color: "#475569",
    lineHeight: 21,
  },
  inlineButtons: {
    marginTop: 16,
    gap: 10,
  },
  error: {
    marginTop: 12,
    color: "#b91c1c",
  },
  listCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
    gap: 12,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  listKicker: {
    color: "#0f766e",
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  listTitle: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
  },
  listBody: {
    color: "#475569",
    lineHeight: 21,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusUnread: {
    backgroundColor: "#fee2e2",
  },
  statusRead: {
    backgroundColor: "#ecfccb",
  },
  statusApproval: {
    backgroundColor: "#eff6ff",
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: "800",
  },
  statusUnreadText: {
    color: "#991b1b",
  },
  statusReadText: {
    color: "#3f6212",
  },
  statusApprovalText: {
    color: "#1d4ed8",
  },
  emptyState: {
    marginTop: 14,
    color: "#64748b",
  },
  profileCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#f0fdfa",
    borderWidth: 1,
    borderColor: "#99f6e4",
  },
  profileName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
  },
  profileText: {
    marginTop: 8,
    color: "#475569",
    lineHeight: 21,
  },
  textarea: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  buttonPair: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  buttonHalf: {
    flex: 1,
  },
});
