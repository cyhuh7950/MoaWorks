import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Button, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createMobileSessionAdapter, isSessionInvalidatedError, requestJson } from "./auth-session";
import { buildMonthGrid, buildSchedulePayload, filterSchedulesForMonth, selectDefaultCalendar } from "./schedule-api";

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
  preview?: string | null;
  snippet?: string | null;
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

type WorkspaceFile = {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  status: string;
  created_at: string;
  updated_at: string;
};
type WorkspaceCalendar = { id: string; name?: string; isDefault?: boolean };
type WorkspaceSchedule = { id: string; title: string; starts_at: string; ends_at?: string; description?: string; location?: string };
type ScheduleForm = { title: string; startsAt: string; endsAt: string; description: string; location: string };

type AppLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-CN" | "es-ES" | "fr-FR" | "de-DE";
type MobileTab = "home" | "mail" | "approval" | "chat" | "calendar" | "more" | "files";
type ScreenKey = MobileTab | "directory" | "ai" | "search" | "settings";
type LlmProvider = "CEREBRAS" | "GROQ" | "MISTRAL" | "OPENAI" | "UPSTAGE" | "GEMINI" | "OPENROUTER" | "ANTHROPIC" | "OLLAMA";
type IconName = "home" | "mail" | "approval" | "chat" | "calendar" | "directory" | "ai" | "search" | "settings" | "more" | "files";

const iconGlyphs: Record<IconName, string> = {
  home: "⌂", mail: "✉", approval: "✓", chat: "◌", calendar: "▣", directory: "♙", ai: "✦", search: "⌕", settings: "⚙", more: "•••", files: "▤",
};

function MoaIcon({ name, color = "#0f766e", size = 18 }: { name: IconName; color?: string; size?: number }) {
  return <Text accessibilityLabel={`${name} 아이콘`} style={{ color, fontSize: size, lineHeight: size + 2, fontWeight: "800", textAlign: "center" }}>{iconGlyphs[name]}</Text>;
}

const llmProviders: LlmProvider[] = ["CEREBRAS", "GROQ", "MISTRAL", "OPENAI", "UPSTAGE", "GEMINI", "OPENROUTER", "ANTHROPIC", "OLLAMA"];
const directoryEntries: Array<{ name: string; team: string; role: string; email: string }> = [];

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
  const [mailQuery, setMailQuery] = useState("");
  const [mailFilter, setMailFilter] = useState<"all" | "unread" | "starred">("all");
  const [rooms, setRooms] = useState<MessengerRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [roomMessages, setRoomMessages] = useState<MessengerMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [fileError, setFileError] = useState("");
  const [calendars, setCalendars] = useState<WorkspaceCalendar[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>({ title: "", startsAt: "", endsAt: "", description: "", location: "" });
  const [scheduleMonth, setScheduleMonth] = useState(() => new Date());
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [moreScreen, setMoreScreen] = useState<Exclude<ScreenKey, MobileTab>>("directory");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [screenDensity, setScreenDensity] = useState<"standard" | "compact">("standard");
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("GROQ");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmConnected, setLlmConnected] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiMessages, setAiMessages] = useState<Array<{ role: "user" | "assistant"; body: string }>>([]);
  const sessionControllerRef = useRef(createMobileSessionAdapter({
    onLoginCommitted({ token: nextToken, user: nextUser }) {
      setToken(nextToken);
      setMe(nextUser);
    },
    onSessionReset(nextState) {
      setToken(nextState.token);
      setMe(nextState.user);
      setPassword(nextState.password);
      setDocuments(nextState.documents);
      setCreateForm(nextState.createForm);
      setNotifications(nextState.notifications);
      setNotificationSummary(nextState.notificationSummary);
      setNotificationError(nextState.notificationError);
      setActiveTab(nextState.activeTab);
      setMailItems(nextState.mailItems);
      setSelectedMailId(nextState.selectedMailId);
      setSelectedMailDetail(nextState.selectedMailDetail);
      setMailError(nextState.mailError);
      setMailQuery(nextState.mailQuery);
      setMailFilter(nextState.mailFilter);
      setRooms(nextState.rooms);
      setSelectedRoomId(nextState.selectedRoomId);
      setRoomMessages(nextState.roomMessages);
      setChatDraft(nextState.chatDraft);
      setChatError(nextState.chatError);
      setFiles(nextState.files);
      setFileError(nextState.fileError);
      setCalendars(nextState.calendars);
      setSchedules(nextState.schedules);
      setScheduleError(nextState.scheduleError);
      setScheduleForm(nextState.scheduleForm);
      setActionReason(nextState.actionReason);
      setLlmProvider(nextState.llmProvider);
      setLlmApiKey(nextState.llmApiKey);
      setLlmConnected(nextState.llmConnected);
      setAiDraft(nextState.aiDraft);
      setAiMessages(nextState.aiMessages);
      setMessage(nextState.message);
    },
  }));
  const activeTabError = activeTab === "files" ? fileError : activeTab === "calendar" ? scheduleError : activeTab === "mail" ? mailError : activeTab === "chat" ? chatError : "";

  function connectLlm() {
    if (!llmApiKey.trim()) {
      setMessage("LLM API 키를 입력한 뒤 연결 테스트를 실행하세요.");
      setLlmConnected(false);
      return;
    }
    setLlmConnected(true);
    setMessage(`${llmProvider} 연결 정보가 이 기기에서 준비되었습니다.`);
  }

  function askAi() {
    const prompt = aiDraft.trim();
    if (!prompt) return;
    setAiMessages((current) => [...current, { role: "user", body: prompt }, { role: "assistant", body: llmConnected ? `${llmProvider} 연결 후 답변이 표시됩니다.` : "먼저 개인 LLM API 키를 연결해 주세요." }]);
    setAiDraft("");
  }

  function saveAppSettings() {
    setMessage("서버·화면 설정이 현재 앱 세션에 적용되었습니다.");
  }

  function clearSession(nextMessage = "") {
    sessionControllerRef.current.clearSession(nextMessage);
  }

  async function request<T>(path: string, init: RequestInit | undefined, context: { generation: number; token: string }): Promise<T> {
    return await sessionControllerRef.current.requestForSession({ apiBase, path, init, context }) as T;
  }

  async function applyProtectedResponse<T>(context: { generation: number; token: string }, operation: () => Promise<T>, apply: (value: T) => void) {
    return await sessionControllerRef.current.applyProtectedResponse(context, operation, apply);
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function withRetry<T>(task: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (isSessionInvalidatedError(error)) {
        throw error;
      }
      if (attempt >= notificationPolicy.retryMax) {
        throw error;
      }
      await sleep(notificationPolicy.retryDelayMs * attempt);
      return withRetry(task, attempt + 1);
    }
  }

  async function loadNotifications(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    const [summary, body] = await Promise.all([
      request<NotificationSummary>("/notifications/summary", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context),
      request<{ notifications: NotificationRecord[] }>("/notifications?limit=20", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context),
    ]);
    if (!sessionControllerRef.current.isCurrent(context)) return;
    setNotificationSummary(summary);
    setNotifications(body.notifications ?? []);
    setNotificationError("");
  }

  async function refreshNotifications(context = sessionControllerRef.current.capture(token)) {
    try {
      await withRetry(() => loadNotifications(token, context));
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
    }
  }

  async function executeAckNotification(notificationId: string) {
    const context = sessionControllerRef.current.capture(token);
    try {
      await request(`/notifications/${notificationId}/ack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      await refreshNotifications(context);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setNotificationError(error instanceof Error ? error.message : "읽음 처리 실패");
    }
  }

  async function doLogin() {
    let loginContext: { generation: number; token: string } | null = null;
    try {
      const loginResult = await sessionControllerRef.current.login({
        apiBase,
        identifier: email,
        password,
      });
      if (!loginResult.committed) return;
      const context = loginResult.context;
      loginContext = context;
      setToken(loginResult.login.accessToken);
      setMe(loginResult.me.user);
      setMessage("로그인 성공");
      const initialRequests = await sessionControllerRef.current.runInitialRequests(context, [
        () => loadApprovals(loginResult.login.accessToken, context),
        () => loadNotifications(loginResult.login.accessToken, context),
        () => loadMail(loginResult.login.accessToken, undefined, context),
        () => loadRooms(loginResult.login.accessToken, undefined, context),
        () => loadFiles(loginResult.login.accessToken, context),
        () => loadSchedules(loginResult.login.accessToken, context),
      ]);
      if (!initialRequests.applied) return;
    } catch (error) {
      const loginAttempt = (error as { loginAttempt?: { generation: number } }).loginAttempt;
      const errorContext = (error as { sessionContext?: { generation: number; token: string } }).sessionContext ?? loginContext;
      if (loginAttempt && !sessionControllerRef.current.isAttemptCurrent(loginAttempt)) return;
      if (errorContext && !sessionControllerRef.current.isCurrent(errorContext)) return;
      if (isSessionInvalidatedError(error)) return;
      setMessage(error instanceof Error ? error.message : "로그인 실패");
    }
  }

  async function loadApprovals(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    try {
      const body = await request<{ documents: Approval[] }>("/approvals", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setDocuments(body.documents);
      setMessage("");
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setMessage(error instanceof Error ? error.message : "조회 실패");
    }
  }

  async function loadMail(activeToken: string = token, preferredMailId?: string, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const inboxResponse = await applyProtectedResponse(context, () => request<{ mails: MailSummary[] }>("/mail/inbox", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (body) => {
        setMailItems(body.mails ?? []);
      });
      if (!inboxResponse.applied) return;
      const inbox = inboxResponse.value;
      const mails = inbox.mails ?? [];
      const targetMailId = preferredMailId || selectedMailId || mails[0]?.mailId || "";
      if (targetMailId) {
        const detailResponse = await applyProtectedResponse(context, () => request<MailDetail>(`/mail/${targetMailId}`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        }, context), (detail) => {
          setSelectedMailId(targetMailId);
          setSelectedMailDetail(detail);
          setMailError("");
        });
        if (!detailResponse.applied) return;
      } else {
        setSelectedMailId("");
        setSelectedMailDetail(null);
        setMailError("");
      }
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "메일 조회 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function openMail(mailId: string, activeToken: string = token) {
    if (!activeToken) return;
    const context = sessionControllerRef.current.capture(activeToken);
    try {
      const readResponse = await applyProtectedResponse(context, () => request(`/mail/${mailId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), () => {});
      if (!readResponse.applied) return;
      const detailResponse = await applyProtectedResponse(context, () => request<MailDetail>(`/mail/${mailId}`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (detail) => {
        setSelectedMailId(mailId);
        setSelectedMailDetail(detail);
        setMailItems((current) => current.map((item) => (item.mailId === mailId ? { ...item, isRead: true } : item)));
        setMailError("");
      });
      if (!detailResponse.applied) return;
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "메일 상세 조회 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function toggleMailStarState(mailId: string, activeToken: string = token) {
    if (!activeToken) return;
    const context = sessionControllerRef.current.capture(activeToken);
    try {
      await request(`/mail/${mailId}/star`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      await loadMail(activeToken, mailId, context);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "중요 표시 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function loadRooms(activeToken: string = token, preferredRoomId?: string, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const roomsResponse = await applyProtectedResponse(context, () => request<{ rooms: MessengerRoom[] }>("/messenger/rooms", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (body) => {
        setRooms(body.rooms ?? []);
      });
      if (!roomsResponse.applied) return;
      const body = roomsResponse.value;
      const nextRooms = body.rooms ?? [];
      const roomId = preferredRoomId || selectedRoomId || nextRooms[0]?.roomId || "";
      if (roomId) {
        const messagesResponse = await applyProtectedResponse(context, () => request<{ messages: MessengerMessage[] }>(`/messenger/rooms/${roomId}/messages`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        }, context), (messages) => {
          setSelectedRoomId(roomId);
          setRoomMessages(messages.messages ?? []);
          setChatError("");
        });
        if (!messagesResponse.applied) return;
      } else {
        setSelectedRoomId("");
        setRoomMessages([]);
        setChatError("");
      }
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "메신저 조회 실패";
      setChatError(nextError);
      setMessage(nextError);
    }
  }

  async function loadFiles(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const body = await request<{ items: WorkspaceFile[] }>("/workspace/files?scope=mine", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setFiles(body.items ?? []);
      setFileError("");
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setFileError(error instanceof Error ? error.message : "파일 조회 실패");
    }
  }

  async function loadSchedules(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const [calendarBody, scheduleBody] = await Promise.all([
        request<{ owned: WorkspaceCalendar[] }>("/workspace/calendars", { headers: { Authorization: `Bearer ${activeToken}` } }, context),
        request<{ schedules: WorkspaceSchedule[] }>("/workspace/schedules", { headers: { Authorization: `Bearer ${activeToken}` } }, context),
      ]);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setCalendars(calendarBody.owned ?? []);
      setSchedules(scheduleBody.schedules ?? []);
      setScheduleError("");
    } catch (error) {
      if (isSessionInvalidatedError(error) || !sessionControllerRef.current.isCurrent(context)) return;
      setScheduleError(error instanceof Error ? error.message : "일정 조회 실패");
    }
  }

  async function createSchedule() {
    if (scheduleSaving) return;
    const context = sessionControllerRef.current.capture(token);
    try {
      const calendar = selectDefaultCalendar({ owned: calendars });
      const payload = buildSchedulePayload({ ...scheduleForm, calendarId: calendar?.id || "", timezone });
      setScheduleSaving(true);
      await request("/workspace/schedules", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setScheduleForm({ title: "", startsAt: "", endsAt: "", description: "", location: "" });
      await loadSchedules(token, context);
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setScheduleError(error instanceof Error ? error.message : "일정 생성 실패");
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) setScheduleSaving(false);
    }
  }

  async function refreshAuthenticatedData(activeToken: string, context = sessionControllerRef.current.capture(activeToken)) {
    if (!sessionControllerRef.current.isCurrent(context)) return;
    await Promise.all([
      loadApprovals(activeToken, context),
      withRetry(() => loadNotifications(activeToken, context)).catch((error) => {
        if (isSessionInvalidatedError(error)) return;
        if (!sessionControllerRef.current.isCurrent(context)) return;
        setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
      }),
      loadMail(activeToken, undefined, context),
      loadRooms(activeToken, undefined, context),
      loadFiles(activeToken, context),
      loadSchedules(activeToken, context),
    ]);
  }

  async function openRoom(roomId: string, activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const readResponse = await applyProtectedResponse(context, () => request(`/messenger/rooms/${roomId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), () => {});
      if (!readResponse.applied) return;
      const messagesResponse = await applyProtectedResponse(context, () => request<{ messages: MessengerMessage[] }>(`/messenger/rooms/${roomId}/messages`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (messages) => {
        setSelectedRoomId(roomId);
        setRoomMessages(messages.messages ?? []);
        setRooms((current) => current.map((item) => (item.roomId === roomId ? { ...item, unreadCount: 0 } : item)));
        setChatError("");
      });
      if (!messagesResponse.applied) return;
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "대화방 조회 실패";
      setChatError(nextError);
      setMessage(nextError);
    }
  }

  async function sendChatMessage() {
    if (!token || !selectedRoomId || !chatDraft.trim()) return;
    const context = sessionControllerRef.current.capture(token);
    try {
      await request(`/messenger/rooms/${selectedRoomId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: chatDraft.trim(), messageType: "text", attachmentMeta: [] }),
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setChatDraft("");
      await openRoom(selectedRoomId, token, context);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
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
      return;
    }
    if (nextTab === "files") {
      void loadFiles(token);
      return;
    }
    if (nextTab === "calendar") {
      void loadSchedules(token);
    }
  }

  async function action(documentId: string, type: "submit" | "withdraw" | "redraft") {
    const context = sessionControllerRef.current.capture(token);
    try {
      await request(`/approvals/${documentId}/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      await loadApprovals(token, context);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      Alert.alert("작업 실패", error instanceof Error ? error.message : "요청 실패");
    }
  }

  async function actionWithReason(documentId: string, type: "approve" | "reject") {
    const context = sessionControllerRef.current.capture(token);
    try {
      await request(`/approvals/${documentId}/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: actionReason || "확인" }),
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      await loadApprovals(token, context);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      Alert.alert("작업 실패", error instanceof Error ? error.message : "요청 실패");
    }
  }

  function can(permission: string) {
    return me?.permissions.includes(permission) ?? false;
  }

  async function createApprovalDocument() {
    const context = sessionControllerRef.current.capture(token);
    try {
      await request("/approvals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: createForm.title,
          content: createForm.content,
          approverUserIds: createForm.approverUserIds.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setCreateForm({ title: "", content: "", approverUserIds: "" });
      await loadApprovals(token, context);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
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
      const context = sessionControllerRef.current.capture(token);
      void refreshAuthenticatedData(token, context);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const context = sessionControllerRef.current.capture(token);
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshAuthenticatedData(token, context);
      }
    });
    return () => subscription.remove();
  }, [token]);

  useEffect(() => {
    void requestJson({ apiBase, path: "/ui-contract" })
      .then((contract: UiContract) => setUiContract({ ...defaultUiContract, ...contract }))
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
  const visibleMailItems = mailItems.filter((item) => {
    const normalizedQuery = mailQuery.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || `${item.senderEmail} ${item.subject}`.toLowerCase().includes(normalizedQuery);
    const matchesFilter = mailFilter === "all" || (mailFilter === "unread" ? !item.isRead : item.isStarred);
    return matchesQuery && matchesFilter;
  });
  const activeTabLabel = activeTab === "home" ? "홈" : activeTab === "mail" ? "메일" : activeTab === "approval" ? "결재" : activeTab === "chat" ? "메신저" : activeTab === "calendar" ? "일정" : activeTab === "files" ? "파일" : "더보기";

  return (
    <SafeAreaView style={styles.safe}>
      {me ? (
        <View style={styles.mobileShellHeader}>
          <View>
            <Text style={styles.shellBrand}>MoaWorks</Text>
            <Text style={styles.shellTitle}>{activeTabLabel}</Text>
          </View>
          <View style={styles.shellHeaderActions}>
            <Text style={styles.shellHeaderChip}>알림 {notificationSummary?.unreadCount ?? 0}</Text>
            <Text style={styles.shellHeaderActionText}>⋯</Text>
          </View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={[styles.container, screenDensity === "compact" ? styles.containerCompact : null]}>
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>MoaWorks Mobile</Text>
          <Text style={styles.heroTitle}>{me ? "오늘의 업무" : "사용자 업무 포털"}</Text>
          <Text style={styles.heroDesc}>
            {me ? "필요한 업무를 한 화면에서 빠르게 확인하세요." : "메일, 결재, 메신저를 한 곳에서 이어가는 업무 포털입니다."}
          </Text>

          {!me ? (
            <>
              <Text style={styles.sectionLabel}>아이디</Text>
              <View style={styles.loginField}>
                <MoaIcon name="directory" color="#99f6e4" size={20} />
                <TextInput
                  style={styles.loginInput}
                  value={email}
                  onChangeText={setEmail}
                  accessibilityLabel="아이디 또는 이메일"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="default"
                  placeholder="아이디 또는 이메일"
                  placeholderTextColor="#94a3b8"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
              </View>
              <Text style={styles.sectionLabel}>비밀번호</Text>
              <View style={styles.loginField}>
                <MoaIcon name="settings" color="#99f6e4" size={20} />
                <TextInput
                  ref={passwordInputRef}
                  style={styles.loginInput}
                  value={password}
                  onChangeText={setPassword}
                  accessibilityLabel="비밀번호"
                  secureTextEntry
                  autoCorrect={false}
                  autoComplete="off"
                  placeholder="비밀번호"
                  placeholderTextColor="#94a3b8"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void doLogin();
                  }}
                />
              </View>
              <View style={styles.buttonBlock}>
                <Pressable accessibilityRole="button" accessibilityLabel="업무 포털 로그인" onPress={() => { void doLogin(); }} style={styles.loginButton}>
                  <MoaIcon name="home" color="#ffffff" size={20} />
                  <Text style={styles.loginButtonText}>업무 포털 로그인</Text>
                </Pressable>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="로그아웃"
                onPress={() => {
                  clearSession("로그아웃되었습니다.");
                }}
                style={styles.heroLogoutButton}
              >
                <Text style={styles.heroLogoutText}>로그아웃</Text>
              </Pressable>
            </View>
          )}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>

        {me ? (
          <>
            {activeTab !== "home" ? (
              <View style={styles.homeSummaryGrid}>
                {summaryCards.map((item) => (
                  <View key={item.title} style={[styles.homeSummaryCard, item.tone]}>
                    <Text style={styles.homeSummaryLabel}>{item.title}</Text>
                    <Text style={styles.homeSummaryValue}>{item.value}</Text>
                    <Text style={styles.homeSummaryDesc}>{item.desc}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {activeTab === "more" || activeTabError ? (
              <View style={styles.surfaceCard}>
              {activeTab === "more" ? (
                <View style={styles.mobileSubNav}>
                  {[{ id: "directory", label: "주소록", icon: "directory" }, { id: "ai", label: "AI 채팅", icon: "ai" }, { id: "search", label: "업무 검색", icon: "search" }, { id: "settings", label: "설정", icon: "settings" }].map((item) => (
                    <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} 메뉴`} onPress={() => setMoreScreen(item.id as Exclude<ScreenKey, MobileTab>)} style={[styles.mobileSubTab, moreScreen === item.id ? styles.mobileSubTabActive : styles.mobileSubTabIdle]}><MoaIcon name={item.icon as IconName} color={moreScreen === item.id ? "#ffffff" : "#0f766e"} /><Text style={[styles.mobileTabLabel, moreScreen === item.id ? styles.mobileTabLabelActive : null]}>{item.label}</Text></Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            ) : null}

            {activeTab === "calendar" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>일정</Text>
                <Text style={styles.surfaceTitle}>오늘의 일정</Text>
                <View style={styles.buttonPair}><Button title="이전 달" onPress={() => setScheduleMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))} /><Button title="다음 달" onPress={() => setScheduleMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))} /></View>
                <Text style={styles.surfaceHint}>{`${scheduleMonth.getFullYear()}년 ${scheduleMonth.getMonth() + 1}월 · ${timezone}`}</Text>
                <View style={styles.calendarGrid}>{buildMonthGrid(new Date(Date.UTC(scheduleMonth.getFullYear(), scheduleMonth.getMonth(), 1))).map((cell, index) => <View key={`${cell.dateKey}-${index}`} style={styles.calendarCell}><Text style={styles.calendarDate}>{cell.day || ""}</Text>{filterSchedulesForMonth(schedules, `${scheduleMonth.getFullYear()}-${String(scheduleMonth.getMonth() + 1).padStart(2, "0")}`, timezone).filter((item) => item.starts_at && item.starts_at.includes(cell.dateKey)).slice(0, 2).map((item) => <Text key={item.id} style={styles.calendarEvent}>{item.title}</Text>)}</View>)}</View>
                {schedules.length === 0 ? <Text style={styles.emptyState}>표시할 일정이 없습니다.</Text> : null}
                <TextInput accessibilityLabel="일정 제목" style={styles.input} value={scheduleForm.title} onChangeText={(title) => setScheduleForm((current) => ({ ...current, title }))} placeholder="일정 제목" />
                <TextInput accessibilityLabel="일정 시작 시간" style={styles.input} value={scheduleForm.startsAt} onChangeText={(startsAt) => setScheduleForm((current) => ({ ...current, startsAt }))} placeholder="2026-08-24T09:00:00+09:00" />
                <TextInput accessibilityLabel="일정 종료 시간" style={styles.input} value={scheduleForm.endsAt} onChangeText={(endsAt) => setScheduleForm((current) => ({ ...current, endsAt }))} placeholder="2026-08-24T10:00:00+09:00" />
                <Button title={scheduleSaving ? "저장 중" : "일정 생성"} disabled={scheduleSaving} onPress={() => { void createSchedule(); }} />
                {scheduleError ? <Text style={styles.error}>{scheduleError}</Text> : null}
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "directory" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>주소록</Text>
                <Text style={styles.surfaceTitle}>사원 정보 검색</Text>
                <TextInput style={styles.input} value={directoryQuery} onChangeText={setDirectoryQuery} placeholder="이름, 부서, 이메일 검색" />
                {directoryEntries.filter((item) => `${item.name}${item.team}${item.email}`.toLowerCase().includes(directoryQuery.toLowerCase())).map((item) => <View key={item.email} style={styles.directoryCard}><View style={styles.avatar}><Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text></View><View style={styles.directoryInfo}><Text style={styles.listTitle}>{item.name}</Text><Text style={styles.listBody}>{item.team} · {item.role}</Text><Text style={styles.listBody}>{item.email}</Text></View></View>)}
                {directoryEntries.length === 0 ? <Text style={styles.emptyState}>표시할 주소록 정보가 없습니다.</Text> : null}
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "ai" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>AI 채팅</Text>
                <Text style={styles.surfaceTitle}>연결된 LLM에게 질문하고 검색</Text>
                <Text style={styles.surfaceHint}>개인 API 키는 이 화면에서만 입력하며, 실제 Provider 호출은 서버 보안 프록시로 연결합니다.</Text>
                {aiMessages.map((item, index) => <View key={`${item.role}-${index}`} style={[styles.aiBubble, item.role === "user" ? styles.aiUserBubble : styles.aiAssistantBubble]}><Text style={styles.aiRole}>{item.role === "user" ? "나" : llmProvider}</Text><Text style={styles.listBody}>{item.body}</Text></View>)}
                <TextInput style={[styles.input, styles.textarea]} value={aiDraft} onChangeText={setAiDraft} placeholder="질문을 입력하세요." multiline />
                <Button title="질문 보내기" onPress={askAi} />
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "search" ? (
              <View style={styles.surfaceCard}><Text style={styles.surfaceKicker}>업무 검색</Text><Text style={styles.surfaceTitle}>메일·결재·메신저 통합 검색</Text><TextInput style={styles.input} placeholder="검색어를 입력하세요." /><Text style={styles.emptyState}>검색어를 입력하면 관련 업무가 표시됩니다.</Text></View>
            ) : null}

            {activeTab === "more" && moreScreen === "settings" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>설정</Text><Text style={styles.surfaceTitle}>앱 기본 설정</Text>
                <Text style={styles.sectionLabel}>연결 서버</Text><TextInput style={styles.input} value={apiBase} onChangeText={setApiBase} autoCapitalize="none" />
                <Text style={styles.sectionLabel}>화면 언어</Text><Text style={styles.settingsValue}>{locale}</Text><Text style={styles.sectionLabel}>시간대</Text><Text style={styles.settingsValue}>{timezone}</Text>
                <Text style={styles.sectionLabel}>화면 밀도</Text><View style={styles.providerRow}><Text onPress={() => setScreenDensity("standard")} style={[styles.providerChip, screenDensity === "standard" ? styles.providerChipActive : null]}>표준</Text><Text onPress={() => setScreenDensity("compact")} style={[styles.providerChip, screenDensity === "compact" ? styles.providerChipActive : null]}>간결</Text></View>
                <Text style={styles.sectionLabel}>LLM Provider</Text><View style={styles.providerRow}>{llmProviders.map((provider) => <Text key={provider} onPress={() => setLlmProvider(provider)} style={[styles.providerChip, llmProvider === provider ? styles.providerChipActive : null]}>{provider}</Text>)}</View>
                <TextInput style={styles.input} value={llmApiKey} onChangeText={setLlmApiKey} placeholder="개인 LLM API 키" secureTextEntry autoCapitalize="none" /><Button title={llmConnected ? "연결됨 · 다시 테스트" : "LLM 연결 테스트"} onPress={connectLlm} /><Button title="설정 저장" onPress={saveAppSettings} />
              </View>
            ) : null}

            <View style={styles.surfaceCard}>
              <Text style={styles.surfaceKicker}>빠른 이동</Text>
              <Text style={styles.surfaceTitle}>모바일 주요 업무 탭</Text>
              <View style={styles.mobileTabRow}>
                {[
                  { id: "home", label: "홈" },
                  { id: "mail", label: "메일" },
                  { id: "approval", label: "결재" },
                  { id: "chat", label: "메신저" },
                  { id: "calendar", label: "일정" },
                  { id: "files", label: "파일" },
                  { id: "more", label: "더보기" },
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

            {activeTab === "home" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>홈</Text>
                <Text style={styles.surfaceTitle}>오늘의 업무를 빠르게 확인하세요</Text>
                <View style={styles.quickGrid}>
                  {homeQuickCards.map((item) => (
                    <Pressable
                      key={item.title}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title} 화면 열기`}
                      onPress={() => {
                        const nextTab: MobileTab = item.id === "mail" ? "mail" : item.id === "approval" ? "approval" : item.id === "chat" ? "chat" : "home";
                        if (nextTab !== "home") setActiveTab(nextTab);
                      }}
                      style={[styles.quickCard, item.tone]}
                    >
                      <Text style={styles.quickCardTitle}>{item.title}</Text>
                      <Text style={styles.quickCardNote}>{item.note}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.homeDetailGrid}>
                  <View style={styles.homeDetailCard}>
                    <Text style={styles.listKicker}>오늘 일정</Text>
                    <Text style={styles.emptyState}>표시할 일정이 없습니다.</Text>
                    <Text style={styles.listBody}>일정 메뉴에서 연결 상태와 상세 내용을 확인하세요.</Text>
                  </View>
                  <View style={styles.homeDetailCard}>
                    <Text style={styles.listKicker}>최근 대화</Text>
                    {rooms.slice(0, 2).map((room) => (
                      <Pressable key={room.roomId} accessibilityRole="button" accessibilityLabel={`${room.roomName} 대화 열기`} onPress={() => { setActiveTab("chat"); void openRoom(room.roomId); }} style={styles.homeRecentRow}>
                        <Text style={styles.listTitle}>{room.roomName}</Text>
                        <Text style={styles.listBody}>{room.lastMessage || "최근 메시지 없음"}</Text>
                      </Pressable>
                    ))}
                    {rooms.length === 0 ? <Text style={styles.emptyState}>최근 대화가 없습니다.</Text> : null}
                  </View>
                </View>
              </View>
            ) : null}

            {activeTab === "mail" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>메일</Text>
                <Text style={styles.surfaceTitle}>받은편지함</Text>
                <TextInput
                  accessibilityLabel="메일 검색"
                  style={styles.input}
                  value={mailQuery}
                  onChangeText={setMailQuery}
                  placeholder="보낸 사람 또는 제목 검색"
                  autoCapitalize="none"
                />
                <View style={styles.mobileSubNav}>
                  {(["all", "unread", "starred"] as const).map((filter) => (
                    <Pressable
                      key={filter}
                      accessibilityRole="button"
                      accessibilityLabel={filter === "all" ? "전체 메일" : filter === "unread" ? "읽지 않은 메일" : "중요 메일"}
                      onPress={() => setMailFilter(filter)}
                      style={[styles.mobileSubTab, mailFilter === filter ? styles.mobileSubTabActive : styles.mobileSubTabIdle]}
                    >
                      <Text style={mailFilter === filter ? styles.mobileTabLabelActive : styles.mobileTabLabel}>{filter === "all" ? "전체" : filter === "unread" ? "안 읽음" : "중요"}</Text>
                    </Pressable>
                  ))}
                </View>
                <View accessibilityLabel="메일 목록" style={styles.mailList}>
                  {visibleMailItems.map((item) => (
                    <Pressable
                      key={item.mailId}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.senderEmail} ${item.subject} 메일 열기`}
                      onPress={() => { void openMail(item.mailId); }}
                      style={[styles.mailRow, !item.isRead ? styles.mailRowUnread : null, selectedMailId === item.mailId ? styles.mailRowSelected : null]}
                    >
                      <View style={styles.mailRowMain}>
                        <View style={styles.mailRowTop}>
                          <Text style={[styles.mailSender, !item.isRead ? styles.mailUnreadText : null]} numberOfLines={1}>{item.senderEmail}</Text>
                          {item.isStarred ? <Text accessibilityLabel="중요 메일" style={styles.mailStar}>★</Text> : null}
                          <Text style={styles.mailDate}>{formatStamp(item.receivedAt || item.sentAt)}</Text>
                        </View>
                        <View style={styles.mailRowBottom}>
                          <Text style={[styles.mailSubject, !item.isRead ? styles.mailUnreadText : null]} numberOfLines={1}>{item.subject || "(제목 없음)"}</Text>
                          <Text style={styles.mailPreview} numberOfLines={1}>{item.preview || item.snippet || "본문 미리보기 없음"}</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
                {visibleMailItems.length === 0 ? <Text style={styles.emptyState}>조건에 맞는 메일이 없습니다.</Text> : null}
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

            {activeTab === "files" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>파일</Text>
                <Text style={styles.surfaceTitle}>내 파일 / 최근 수정</Text>
                <View style={styles.quickGrid}>
                  <View style={[styles.quickCard, styles.quickTeal]}>
                    <Text style={styles.quickCardTitle}>내 파일</Text>
                    <Text style={styles.quickCardNote}>{files.length}개</Text>
                  </View>
                </View>
                {files.length === 0 ? <Text style={styles.emptyState}>표시할 파일이 없습니다.</Text> : null}
                {files.slice(0, 20).map((item) => (
                  <View key={item.id} style={styles.listCard}>
                    <Text style={styles.listKicker}>{item.status}</Text>
                    <Text style={styles.listTitle}>{item.file_name}</Text>
                    <Text style={styles.listBody}>{`${item.content_type} · ${item.size_bytes.toLocaleString()} B · ${formatStamp(item.updated_at)}`}</Text>
                  </View>
                ))}
                {fileError ? <Text style={styles.error}>{fileError}</Text> : null}
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
                    clearSession("로그아웃되었습니다.");
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
      {me ? (
        <View style={styles.mobileBottomNav}>
          {[{ id: "home", label: "홈", icon: "home" }, { id: "mail", label: "메일", icon: "mail" }, { id: "approval", label: "결재", icon: "approval" }, { id: "chat", label: "메신저", icon: "chat" }, { id: "calendar", label: "일정", icon: "calendar" }, { id: "files", label: "파일", icon: "files" }, { id: "more", label: "더보기", icon: "more" }].map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} 메뉴`} onPress={() => handleTabPress(item.id as MobileTab)} style={[styles.mobileBottomNavItem, activeTab === item.id ? styles.mobileBottomNavItemActive : null]}>
              <MoaIcon name={item.icon as IconName} color={activeTab === item.id ? "#ffffff" : "#475569"} size={18} />
              <Text style={[styles.mobileBottomNavLabel, activeTab === item.id ? styles.mobileBottomNavLabelActive : null]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#eef4f3",
  },
  mobileShellHeader: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shellBrand: {
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  shellTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 3,
  },
  shellHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  shellHeaderChip: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(153,246,228,0.45)",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  shellHeaderActionText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
  },
  mobileBottomNav: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#dbe4ec",
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  mobileBottomNavItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 12,
  },
  mobileBottomNavItemActive: {
    backgroundColor: "#0f766e",
  },
  mobileBottomNavLabel: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  mobileBottomNavLabelActive: {
    color: "#ffffff",
  },
  container: {
    padding: 18,
    paddingBottom: 96,
    gap: 18,
  },
  containerCompact: {
    padding: 12,
    gap: 12,
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
  loginField: {
    marginTop: 8,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(153,246,228,0.35)",
    backgroundColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 14,
  },
  loginInput: {
    flex: 1,
    minHeight: 50,
    paddingVertical: 10,
    color: "#f8fafc",
    fontSize: 15,
  },
  buttonBlock: {
    marginTop: 16,
  },
  loginButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#0f766e",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  loginButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
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
  heroLogoutButton: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(153,246,228,0.45)",
  },
  heroLogoutText: {
    color: "#99f6e4",
    fontSize: 12,
    fontWeight: "800",
  },
  metricsGrid: {
    gap: 14,
  },
  homeSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  homeSummaryCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 112,
    borderRadius: 18,
    padding: 14,
  },
  homeSummaryLabel: {
    color: "rgba(248,250,252,0.8)",
    fontSize: 11,
    fontWeight: "800",
  },
  homeSummaryValue: {
    marginTop: 8,
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
  },
  homeSummaryDesc: {
    marginTop: 4,
    color: "rgba(248,250,252,0.78)",
    fontSize: 11,
    lineHeight: 16,
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
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
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
  mobileTabLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "800",
  },
  mobileTabLabelActive: {
    color: "#ffffff",
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
  mailList: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#dbe4ec",
  },
  mailRow: {
    minHeight: 68,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  mailRowUnread: {
    backgroundColor: "#f0fdfa",
  },
  mailRowSelected: {
    borderLeftWidth: 3,
    borderLeftColor: "#0f766e",
  },
  mailRowMain: {
    flex: 1,
    gap: 5,
  },
  mailRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mailRowBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mailSender: {
    flex: 1,
    color: "#475569",
    fontSize: 12,
  },
  mailUnreadText: {
    color: "#0f172a",
    fontWeight: "800",
  },
  mailStar: {
    color: "#b45309",
    fontSize: 13,
  },
  mailDate: {
    color: "#64748b",
    fontSize: 10,
  },
  mailSubject: {
    maxWidth: "48%",
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  mailPreview: {
    flex: 1,
    color: "#64748b",
    fontSize: 11,
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
  mobileSubNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  mobileSubTab: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
    fontWeight: "700",
  },
  mobileSubTabActive: {
    backgroundColor: "#0f766e",
    color: "#ffffff",
  },
  mobileSubTabIdle: {
    backgroundColor: "#f1f5f9",
    color: "#334155",
  },
  directoryCard: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
  },
  avatarText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16,
  },
  directoryInfo: {
    flex: 1,
    gap: 4,
  },
  calendarHeader: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  calendarMonth: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
  },
  calendarGrid: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  calendarDay: {
    width: "13.5%",
    textAlign: "center",
    color: "#64748b",
    fontWeight: "700",
  },
  calendarCell: {
    width: "13.5%",
    minHeight: 58,
    padding: 8,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  calendarCellActive: {
    backgroundColor: "#ccfbf1",
    borderColor: "#5eead4",
  },
  calendarDate: {
    color: "#334155",
    fontWeight: "700",
  },
  calendarEvent: {
    marginTop: 5,
    color: "#0f766e",
    fontSize: 10,
    fontWeight: "700",
  },
  aiBubble: {
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
  },
  aiUserBubble: {
    backgroundColor: "#ecfeff",
    borderWidth: 1,
    borderColor: "#99f6e4",
  },
  aiAssistantBubble: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  aiRole: {
    marginBottom: 6,
    color: "#0f766e",
    fontWeight: "800",
  },
  providerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  providerChip: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: "hidden",
    backgroundColor: "#f1f5f9",
    color: "#334155",
    fontWeight: "700",
  },
  providerChipActive: {
    backgroundColor: "#0f766e",
    color: "#ffffff",
  },
  settingsValue: {
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    color: "#334155",
  },
});
