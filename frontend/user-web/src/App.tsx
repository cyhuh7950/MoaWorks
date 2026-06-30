import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  ackNotification,
  apiBase,
  approveApproval,
  ApiRequestError,
  clearUserToken,
  createApproval,
  fetchApprovalLogs,
  fetchApprovals,
  fetchInbox,
  fetchMailDetail,
  fetchMe,
  fetchMessengerMessages,
  fetchMessengerRoom,
  fetchMessengerRooms,
  fetchNotifications,
  fetchNotificationSummary,
  fetchSentMail,
  fetchTranslationStatus,
  fetchUiContract,
  getUserToken,
  login,
  markMailRead,
  readMessengerRoom,
  redraftApproval,
  rejectApproval,
  requestTranslation,
  sendMessengerMessage,
  storeUserToken,
  submitApproval,
  toggleMailStar,
  withdrawApproval,
  type ApprovalDocument,
  type AuthUser,
  type LoginResponse,
  type MailDetail,
  type MailSummary,
  type MessengerMessage,
  type MessengerRoomDetail,
  type MessengerRoomSummary,
  type NotificationRecord,
  type NotificationSummary,
  type TranslationItem,
  type TranslationRequest,
  type TranslationResponse,
  type UiContract as ServerUiContract,
} from "./api";
import { resolveLocale, supportedLocales, supportedTimezones, type AppLocale } from "./i18n";

const NOTIFICATION_POLICY = {
  retryMaxAttempts: 3,
  retryDelayMs: 400,
  streamRetryMax: 2,
  streamReconnectDelayMs: 600,
} as const;

const MAIL_POLICY = {
  serverRetention: "서버 1개월 보관",
  localRetention: "설치형 PC 로컬 아카이브 무기한",
};

const MESSENGER_POLICY = {
  serverRetention: "서버 2주 보관",
  localRetention: "설치형 PC 대화 파일(JSON/HTML) 보관",
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

const defaultUiContract: UiContract = {
  brand: {
    primary: "#0f766e",
    secondary: "#111827",
    accent: "#9a6b2f",
    blocked: "#9f1239",
  },
  menuOrder: ["메일", "결재", "메신저", "일정", "주소록", "조직도", "파일", "설정"],
  homeCardOrder: ["alerts", "approval", "mail", "messenger"],
  quickComposeVisible: true,
  helpText: "Help / 정책 안내 / 설정 > 보관 정책",
  messages: {
    error: "요청 처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
    warning: "설치형 로컬 아카이브 연결을 확인하세요.",
    blocked: "접근 권한이 없거나 세션이 만료되었습니다.",
    empty: "표시할 메일이 없습니다.",
    success: "결재 초안이 저장되었습니다.",
    sessionExpired: "세션이 만료되어 다시 로그인해야 합니다.",
    permissionDenied: "공유 메일함을 열 권한이 없습니다.",
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

type LoginForm = {
  email: string;
  password: string;
};

type CreateForm = {
  title: string;
  content: string;
  approverUserIds: string;
};

type ReasonAction = {
  documentId: string;
  reason: string;
};

type WorkspaceTab = "mail" | "approval" | "messenger";
type UserPortalMenu = "home" | "mail" | "approval" | "messenger" | "schedule" | "contacts" | "org" | "files" | "alerts" | "settings" | "help";
type MailboxType = "inbox" | "sent";
type MailFolderType = MailboxType | "starred" | "unread" | "draft" | "localArchive";
type QuickComposeMode = "none" | "mail" | "approval" | "messenger";

type SurfaceCardProps = {
  title: string;
  value: string;
  subtext: string;
  tone: "teal" | "sand" | "ink" | "rose";
  onClick?: () => void;
};

const toneMap: Record<SurfaceCardProps["tone"], { background: string; border: string; accent: string }> = {
  teal: { background: "linear-gradient(135deg, #0f766e, #115e59)", border: "#115e59", accent: "#99f6e4" },
  sand: { background: "linear-gradient(135deg, #9a6b2f, #7c4a10)", border: "#7c4a10", accent: "#fde68a" },
  ink: { background: "linear-gradient(135deg, #1f2937, #0f172a)", border: "#0f172a", accent: "#bfdbfe" },
  rose: { background: "linear-gradient(135deg, #9f1239, #7f1d1d)", border: "#7f1d1d", accent: "#fecdd3" },
};

function SurfaceCard({ title, value, subtext, tone, onClick }: SurfaceCardProps) {
  const currentTone = toneMap[tone];
  return (
    <article
      onClick={onClick}
      style={{
        background: currentTone.background,
        borderRadius: 24,
        padding: "22px 24px",
        color: "#f8fafc",
        border: `1px solid ${currentTone.border}`,
        boxShadow: "0 20px 40px rgba(15, 23, 42, 0.18)",
        minHeight: 172,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.82 }}>{title}</div>
          <div style={{ marginTop: 18, fontSize: 32, fontWeight: 800, lineHeight: 1.12 }}>{value}</div>
        </div>
        <div
          style={{
            minWidth: 68,
            height: 68,
            borderRadius: 18,
            background: "rgba(255,255,255,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: currentTone.accent,
            fontSize: 26,
            fontWeight: 800,
          }}
        >
          •
        </div>
      </div>
      <div style={{ marginTop: 18, fontSize: 14, color: "rgba(248,250,252,0.88)", lineHeight: 1.6 }}>{subtext}</div>
    </article>
  );
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function summarizeMailPreview(detail: MailDetail | null, fallbackSubject: string): string {
  if (!detail) return fallbackSubject;
  const source = detail.bodyText || detail.subject || fallbackSubject;
  return source.length > 96 ? `${source.slice(0, 96)}...` : source;
}

function normalizeClientError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

export default function App() {
  const [token, setToken] = useState("");
  const [locale, setLocale] = useState<AppLocale>(resolveLocale(window.localStorage.getItem("moaworks.locale")));
  const [timezone, setTimezone] = useState(window.localStorage.getItem("moaworks.timezone") || "Asia/Seoul");
  const [uiContract, setUiContract] = useState<UiContract>(() => defaultUiContract);
  const [searchText, setSearchText] = useState("");
  const [loginForm, setLoginForm] = useState<LoginForm>({ email: "", password: "" });
  const [createForm, setCreateForm] = useState<CreateForm>({
    title: "",
    content: "",
    approverUserIds: "",
  });
  const [loading, setLoading] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [documents, setDocuments] = useState<ApprovalDocument[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<NotificationSummary | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [reasonAction, setReasonAction] = useState<ReasonAction>({ documentId: "", reason: "" });
  const [message, setMessage] = useState("");
  const [translationStatus, setTranslationStatus] = useState<{ provider: string; enabled: boolean; available: boolean } | null>(null);
  const [translationSource, setTranslationSource] = useState("");
  const [translationTargetLocale, setTranslationTargetLocale] = useState("en");
  const [translationResult, setTranslationResult] = useState<TranslationItem[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [me, setMe] = useState<AuthUser | null>(null);
  const [logsCount, setLogsCount] = useState(0);
  const [notificationMode, setNotificationMode] = useState<"polling" | "streaming" | "fallback">("polling");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceTab>("mail");
  const [activePortalMenu, setActivePortalMenu] = useState<UserPortalMenu>("home");
  const [activeMailbox, setActiveMailbox] = useState<MailboxType>("inbox");
  const [activeMailFolder, setActiveMailFolder] = useState<MailFolderType>("inbox");
  const [quickComposeMode, setQuickComposeMode] = useState<QuickComposeMode>("none");
  const [showQuickComposePicker, setShowQuickComposePicker] = useState(false);
  const [selectedContactEmail, setSelectedContactEmail] = useState("");
  const [selectedOrgMember, setSelectedOrgMember] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [inboxMails, setInboxMails] = useState<MailSummary[]>([]);
  const [sentMails, setSentMails] = useState<MailSummary[]>([]);
  const [selectedMailId, setSelectedMailId] = useState("");
  const [selectedMailDetail, setSelectedMailDetail] = useState<MailDetail | null>(null);
  const [mailError, setMailError] = useState("");
  const [mailLoading, setMailLoading] = useState(false);
  const [messengerRoomsData, setMessengerRoomsData] = useState<MessengerRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedRoomDetail, setSelectedRoomDetail] = useState<MessengerRoomDetail | null>(null);
  const [roomMessages, setRoomMessages] = useState<MessengerMessage[]>([]);
  const [messengerDraft, setMessengerDraft] = useState("");
  const [messengerError, setMessengerError] = useState("");
  const [messengerLoading, setMessengerLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const streamCursorRef = useRef<string>("");
  const streamRetryRef = useRef(0);

  async function loadNotificationData(targetToken: string): Promise<void> {
    const summary = await fetchNotificationSummary(targetToken);
    const response = await fetchNotifications(targetToken, { limit: 20, unreadOnly: false });
    setNotificationSummary(summary);
    setNotifications(response.notifications ?? []);
  }

  function saveLocale(nextLocale: AppLocale) {
    setLocale(nextLocale);
    window.localStorage.setItem("moaworks.locale", nextLocale);
  }

  function saveTimezone(nextTimezone: string) {
    setTimezone(nextTimezone);
    window.localStorage.setItem("moaworks.timezone", nextTimezone);
  }

  function resetQuickComposeMode() {
    if (quickComposeMode !== "none") {
      setQuickComposeMode("none");
    }
    if (showQuickComposePicker) {
      setShowQuickComposePicker(false);
    }
  }

  function resolveQuickComposeMode(menu: UserPortalMenu): QuickComposeMode {
    if (menu === "mail") return "mail";
    if (menu === "approval") return "approval";
    if (menu === "messenger") return "messenger";
    return "none";
  }

  async function openQuickCompose() {
    if (!token) return;
    const nextMode = resolveQuickComposeMode(activePortalMenu);
    if (nextMode === "none") {
      setQuickComposeMode("none");
      setShowQuickComposePicker(true);
      return;
    }
    await openQuickComposeByMode(nextMode);
  }

  async function openQuickComposeByMode(nextMode: QuickComposeMode) {
    setShowQuickComposePicker(false);
    setQuickComposeMode(nextMode);
    if (nextMode === "mail") {
      setActiveMailFolder(activeMailbox === "sent" ? "sent" : "inbox");
      setActivePortalMenu("mail");
      return;
    }
    if (nextMode === "messenger") {
      setActivePortalMenu("messenger");
      if (!selectedRoomId && messengerRoomsData[0]?.roomId) {
        await selectMessengerRoom(token, messengerRoomsData[0].roomId, { markRead: true });
      }
      return;
    }
    setActivePortalMenu("approval");
  }

  function setPortalMenu(nextMenu: UserPortalMenu) {
    resetQuickComposeMode();
    setActivePortalMenu(nextMenu);
  }

  function setMailFolder(folder: MailFolderType) {
    setActiveMailFolder(folder);
    resetQuickComposeMode();
    if (folder === "sent") {
      setActiveMailbox("sent");
      return;
    }
    if (folder === "inbox" || folder === "starred" || folder === "unread" || folder === "draft") {
      setActiveMailbox("inbox");
      return;
    }
    if (folder === "localArchive") {
      setActiveMailbox("inbox");
    }
  }

  function getMailListByFolder(folder: MailFolderType) {
    const allMail = [...inboxMails, ...sentMails];
    if (folder === "sent") {
      return sentMails;
    }
    if (folder === "starred") {
      return allMail.filter((item) => item.isStarred);
    }
    if (folder === "unread") {
      return inboxMails.filter((item) => !item.isRead);
    }
    if (folder === "draft") {
      return allMail.filter((item) => item.status === "draft");
    }
    if (folder === "localArchive") {
      return [];
    }
    return inboxMails;
  }

  function inferMailboxFromMailId(mailId: string): MailboxType {
    if (inboxMails.some((item) => item.mailId === mailId)) return "inbox";
    return "sent";
  }

  async function refreshUiContract() {
    const contract = await fetchUiContract();
    setUiContract(mergeUiContract(contract as ServerUiContract));
  }

  function toTranslationLocale(code: string): string {
    const normalized = code.trim().replace("_", "-").toLowerCase();
    if (normalized === "zh-cn") {
      return "zh-cn";
    }
    return normalized.split("-")[0];
  }

  async function loadTranslationState() {
    try {
      const status = await fetchTranslationStatus();
      setTranslationStatus(status as { provider: string; enabled: boolean; available: boolean });
    } catch {
      setTranslationStatus(null);
    }
  }

  async function runTranslationDemo(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setTranslationError("로그인 후 번역 도구를 사용할 수 있습니다.");
      return;
    }
    const trimmed = translationSource.trim();
    if (!trimmed) {
      setTranslationError("원문을 입력하세요.");
      return;
    }
    setTranslationLoading(true);
    setTranslationError("");
    const sourceLocale = toTranslationLocale(locale);
    const targetLocale = toTranslationLocale(translationTargetLocale);
    try {
      const payload: TranslationRequest = {
        texts: [{ text: trimmed, sourceLocale, targetLocale }],
        includeSource: true,
        useCache: true,
      };
      const response: TranslationResponse = await requestTranslation(payload, token);
      setTranslationResult(response.items);
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "번역 실패");
      setTranslationResult([]);
    } finally {
      setTranslationLoading(false);
    }
  }

  function stopNotificationStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function appendNotification(notification: NotificationRecord) {
    setNotifications((current) => {
      const existed = current.some((item) => item.notificationId === notification.notificationId);
      if (existed) {
        return current.map((item) => (item.notificationId === notification.notificationId ? notification : item));
      }
      return [notification, ...current];
    });
  }

  async function refreshNotificationsFallback(targetToken: string) {
    await refreshNotifications(targetToken);
  }

  function applyStreamPolicyError(error: Error) {
    setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
    setNotificationMode("fallback");
    stopNotificationStream();
  }

  function connectNotificationStream(targetToken: string) {
    if (typeof EventSource === "undefined") {
      setNotificationMode("polling");
      return;
    }
    stopNotificationStream();
    const cursorQuery = streamCursorRef.current ? `&cursor=${encodeURIComponent(streamCursorRef.current)}` : "";
    const streamUrl = `${apiBase}/notifications/stream?token=${encodeURIComponent(targetToken)}${cursorQuery}`;
    const source = new EventSource(streamUrl);
    eventSourceRef.current = source;
    setNotificationMode("streaming");

    source.addEventListener("notification", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as NotificationRecord;
        appendNotification(payload);
      } catch {
        // ignore malformed stream payload
      }
    });

    source.addEventListener("streammeta", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { value?: string };
        if (payload.value) {
          streamCursorRef.current = payload.value;
        }
      } catch {
        // ignore malformed payload
      }
    });

    source.addEventListener("heartbeat", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { type?: string };
        if (payload.type === "fallback") {
          applyStreamPolicyError(new Error("stream fallback"));
        }
      } catch (error) {
        if (error instanceof Error && error.message === "stream fallback") {
          return;
        }
        if (error instanceof SyntaxError) {
          return;
        }
        applyStreamPolicyError(error instanceof Error ? error : new Error("stream heartbeat 처리 실패"));
      }
    });

    source.onerror = () => {
      source.close();
      eventSourceRef.current = null;
      if (streamRetryRef.current < NOTIFICATION_POLICY.streamRetryMax) {
        streamRetryRef.current += 1;
        setTimeout(() => {
          if (targetToken) {
            connectNotificationStream(targetToken);
          }
        }, NOTIFICATION_POLICY.streamReconnectDelayMs * streamRetryRef.current);
        return;
      }
      streamRetryRef.current = 0;
      void refreshNotificationsFallback(targetToken).catch(applyStreamPolicyError);
    };

    source.onopen = () => {
      streamRetryRef.current = 0;
      void fetchNotificationSummary(targetToken)
        .then((summary) => setNotificationSummary(summary))
        .catch(() => setNotificationError("알림 요약 조회 실패"));
    };
  }

  async function refreshNotifications(targetToken: string) {
    try {
      setNotificationError("");
      await retryWithBackoff(() => loadNotificationData(targetToken));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
      throw error;
    }
  }

  async function retryWithBackoff<T>(task: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < maxAttempts) {
      try {
        attempt += 1;
        return await task();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("요청 실패");
        if (attempt >= maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, NOTIFICATION_POLICY.retryDelayMs * attempt));
      }
    }
    throw lastError ?? new Error("요청 실패");
  }

  async function reload() {
    if (!token) return;
    const response = await fetchApprovals(token);
    setDocuments(response.documents);
    const logs = await fetchApprovalLogs(token);
    setLogsCount(logs.logs.length);
    setMessage("");
    try {
      await retryWithBackoff(() => loadNotificationData(token));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
    }
  }

  async function selectMail(targetToken: string, mailId: string, mailbox: MailboxType, options?: { markRead?: boolean }) {
    setMailLoading(true);
    setMailError("");
    try {
      if (mailbox === "inbox" && options?.markRead) {
        await markMailRead(targetToken, mailId);
      }
      const detail = await fetchMailDetail(targetToken, mailId);
      setSelectedMailId(mailId);
      setSelectedMailDetail(detail);
      if (mailbox === "inbox" && options?.markRead) {
        setInboxMails((current) => current.map((item) => (item.mailId === mailId ? { ...item, isRead: true } : item)));
      }
    } catch (error) {
      setMailError(normalizeClientError(error, "메일 상세 조회 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  async function loadMailWorkspace(targetToken: string, preferredMailbox?: MailboxType, preferredMailId?: string) {
    setMailLoading(true);
    setMailError("");
    try {
      const [inboxResponse, sentResponse] = await Promise.all([fetchInbox(targetToken), fetchSentMail(targetToken)]);
      const nextInbox = inboxResponse.mails ?? [];
      const nextSent = sentResponse.mails ?? [];
      setInboxMails(nextInbox);
      setSentMails(nextSent);
      const mailbox = preferredMailbox ?? activeMailbox;
      const activeList = mailbox === "sent" ? nextSent : nextInbox;
      const fallbackList = activeList.length ? activeList : mailbox === "sent" ? nextInbox : nextSent;
      const resolvedMailbox = activeList.length ? mailbox : mailbox === "sent" ? "inbox" : "sent";
      const resolvedMailId = preferredMailId ?? selectedMailId;
      const targetMail =
        fallbackList.find((item) => item.mailId === resolvedMailId) ??
        activeList.find((item) => item.mailId === resolvedMailId) ??
        fallbackList[0] ??
        null;
      setActiveMailbox(resolvedMailbox);
      if (targetMail) {
        const detail = await fetchMailDetail(targetToken, targetMail.mailId);
        setSelectedMailId(targetMail.mailId);
        setSelectedMailDetail(detail);
      } else {
        setSelectedMailId("");
        setSelectedMailDetail(null);
      }
    } catch (error) {
      setMailError(normalizeClientError(error, "메일 목록 조회 실패"));
      setInboxMails([]);
      setSentMails([]);
      setSelectedMailId("");
      setSelectedMailDetail(null);
    } finally {
      setMailLoading(false);
    }
  }

  async function toggleSelectedMailStar() {
    if (!token || !selectedMailId) return;
    setMailLoading(true);
    setMailError("");
    try {
      const response = await toggleMailStar(token, selectedMailId);
      setInboxMails((current) =>
        current.map((item) => (item.mailId === selectedMailId ? { ...item, isStarred: Boolean(response.isStarred) } : item)),
      );
      setSentMails((current) =>
        current.map((item) => (item.mailId === selectedMailId ? { ...item, isStarred: Boolean(response.isStarred) } : item)),
      );
      setSelectedMailDetail((current) => (current ? { ...current } : current));
      await selectMail(token, selectedMailId, activeMailbox, { markRead: false });
    } catch (error) {
      setMailError(normalizeClientError(error, "중요 표시 변경 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  async function loadMessengerWorkspace(targetToken: string, preferredRoomId?: string) {
    setMessengerLoading(true);
    setMessengerError("");
    try {
      const roomsResponse = await fetchMessengerRooms(targetToken);
      const rooms = roomsResponse.rooms ?? [];
      setMessengerRoomsData(rooms);
      const targetRoomId = preferredRoomId || selectedRoomId || rooms[0]?.roomId || "";
      if (targetRoomId) {
        const [roomDetail, messagesResponse] = await Promise.all([
          fetchMessengerRoom(targetToken, targetRoomId),
          fetchMessengerMessages(targetToken, targetRoomId),
        ]);
        setSelectedRoomId(targetRoomId);
        setSelectedRoomDetail(roomDetail);
        setRoomMessages(messagesResponse.messages ?? []);
      } else {
        setSelectedRoomId("");
        setSelectedRoomDetail(null);
        setRoomMessages([]);
      }
    } catch (error) {
      setMessengerError(normalizeClientError(error, "메신저 조회 실패"));
      setMessengerRoomsData([]);
      setSelectedRoomId("");
      setSelectedRoomDetail(null);
      setRoomMessages([]);
    } finally {
      setMessengerLoading(false);
    }
  }

  async function selectMessengerRoom(targetToken: string, roomId: string, options?: { markRead?: boolean }) {
    setMessengerLoading(true);
    setMessengerError("");
    try {
      if (options?.markRead) {
        await readMessengerRoom(targetToken, roomId);
      }
      const [roomDetail, messagesResponse] = await Promise.all([
        fetchMessengerRoom(targetToken, roomId),
        fetchMessengerMessages(targetToken, roomId),
      ]);
      setSelectedRoomId(roomId);
      setSelectedRoomDetail(roomDetail);
      setRoomMessages(messagesResponse.messages ?? []);
      if (options?.markRead) {
        setMessengerRoomsData((current) => current.map((item) => (item.roomId === roomId ? { ...item, unreadCount: 0 } : item)));
      }
    } catch (error) {
      setMessengerError(normalizeClientError(error, "대화방 조회 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  async function handleMessengerSend() {
    if (!token || !selectedRoomId || !messengerDraft.trim()) return;
    setMessengerLoading(true);
    setMessengerError("");
    try {
      await sendMessengerMessage(token, selectedRoomId, { body: messengerDraft.trim() });
      setMessengerDraft("");
      await selectMessengerRoom(token, selectedRoomId, { markRead: true });
    } catch (error) {
      setMessengerError(normalizeClientError(error, "메시지 전송 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  useEffect(() => {
    const current = getUserToken();
    if (current) {
      setToken(current);
    }
    void loadTranslationState();
    void refreshUiContract().catch(() => setUiContract(defaultUiContract));
  }, []);

  useEffect(() => {
    if (!token) return;
    void reload().catch((error) => setApprovalError(error instanceof Error ? error.message : "조회 실패"));
    void loadMailWorkspace(token).catch((error) => setMailError(normalizeClientError(error, "메일 조회 실패")));
    void loadMessengerWorkspace(token).catch((error) => setMessengerError(normalizeClientError(error, "메신저 조회 실패")));
    void loadTranslationState().catch(() => undefined);
    connectNotificationStream(token);
    return () => {
      stopNotificationStream();
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      setMe(null);
      setTranslationStatus(null);
      setTranslationResult([]);
      setTranslationError("");
      setInboxMails([]);
      setSentMails([]);
      setSelectedMailId("");
      setSelectedMailDetail(null);
      setMessengerRoomsData([]);
      setSelectedRoomId("");
      setSelectedRoomDetail(null);
      setRoomMessages([]);
      setMailError("");
      setMessengerError("");
      return;
    }
    void fetchMe(token)
      .then((response) => setMe(response.user))
      .catch(() => {
        clearUserToken();
        setToken("");
        setMe(null);
        setTranslationStatus(null);
        setApprovalError("세션이 만료되었거나 접근이 제한되었습니다. 다시 로그인해 주세요.");
      });
  }, [token]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setApprovalError("");
    setMessage("");
    try {
      const response = (await login(loginForm)) as LoginResponse;
      storeUserToken(response.accessToken);
      setToken(response.accessToken);
      setMe(response.user);
      setMessage(`${response.user.userName}님, 업무 포털에 접속했습니다.`);
      await loadTranslationState();
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setApprovalError("");
    try {
      const approverUserIds = createForm.approverUserIds
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      await createApproval(token, {
        title: createForm.title,
        content: createForm.content,
        approverUserIds,
      });
      setCreateForm({ title: "", content: "", approverUserIds: "" });
      setMessage("결재 초안이 저장되었습니다.");
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "작성 실패");
    } finally {
      setLoading(false);
    }
  }

  async function executeApprove(documentId: string, accepted: boolean) {
    if (!token) return;
    setLoading(true);
    setApprovalError("");
    try {
      const act = accepted ? approveApproval : rejectApproval;
      await act(token, documentId, reasonAction.reason || "확인");
      setReasonAction({ documentId: "", reason: "" });
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "처리 실패");
    } finally {
      setLoading(false);
    }
  }

  async function executeSubmit(documentId: string, action: "submit" | "withdraw" | "redraft") {
    if (!token) return;
    setLoading(true);
    setApprovalError("");
    try {
      if (action === "submit") {
        await submitApproval(token, documentId);
      } else if (action === "withdraw") {
        await withdrawApproval(token, documentId);
      } else {
        await redraftApproval(token, documentId);
      }
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "처리 실패");
    } finally {
      setLoading(false);
    }
  }

  async function executeAck(notificationId: string) {
    if (!token) return;
    setLoading(true);
    setNotificationError("");
    try {
      await ackNotification(token, notificationId);
      await refreshNotifications(token);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "읽음 처리 실패");
    } finally {
      setLoading(false);
    }
  }

  const canAct = useMemo(() => {
    const actionSet = new Set(me?.permissions ?? []);
    return {
      read: actionSet.has("approval:read"),
      create: actionSet.has("approval:create"),
      submit: actionSet.has("approval:submit"),
      act: actionSet.has("approval:act"),
      withdraw: actionSet.has("approval:withdraw"),
      rework: actionSet.has("approval:rework"),
    };
  }, [me]);

  const dashboardStats = useMemo(() => {
    const unreadCount = notificationSummary?.unreadCount ?? 0;
    const pendingApprovals = documents.filter((doc) => doc.status === "submitted").length;
    const urgentCount = notificationSummary?.severityCount?.CRITICAL ?? 0;
    const todayApprovals = documents.filter((doc) => doc.status === "draft" || doc.status === "submitted").length;
    return {
      unreadCount,
      pendingApprovals,
      urgentCount,
      todayApprovals,
    };
  }, [documents, notificationSummary]);

  function isCurrentApprover(doc: ApprovalDocument): boolean {
    if (!me) return false;
    if (doc.currentLineIndex == null) return false;
    const line = doc.lines.find((item) => item.sequence === doc.currentLineIndex);
    return Boolean(line && line.approverUserId === me.userId);
  }

  const navItems = [
    { label: "메일", desc: MAIL_POLICY.serverRetention },
    { label: "결재", desc: `${dashboardStats.pendingApprovals}건 대기` },
    { label: "메신저", desc: MESSENGER_POLICY.serverRetention },
    { label: "일정", desc: "오늘 일정 3건 기준 영역" },
    { label: "주소록", desc: "조직도·연락처 연계" },
    { label: "조직도", desc: "부서 및 권한 구조" },
    { label: "파일", desc: "로컬/공유 파일 허브" },
    { label: "설정", desc: "언어, 시간대, Help, 정책 안내" },
  ];

  const orderedNavItems = [...navItems].sort((left, right) => {
    const leftIndex = uiContract.menuOrder.indexOf(left.label);
    const rightIndex = uiContract.menuOrder.indexOf(right.label);
    const safeLeft = leftIndex === -1 ? 999 : leftIndex;
    const safeRight = rightIndex === -1 ? 999 : rightIndex;
    return safeLeft - safeRight;
  });

  const homeSurfaceCards = [
    {
      id: "mail",
      title: "안 읽은 메일",
      value: "준비 중",
      subtext: "안 읽은 메일/중요 메일을 업무 탭에서 바로 진입할 수 있습니다.",
      tone: "ink" as const,
    },
    {
      id: "approval",
      title: "대기 결재",
      value: `${dashboardStats.pendingApprovals}건`,
      subtext: "대기 결재와 상태 변경을 동일 화면에서 바로 시작합니다.",
      tone: "teal" as const,
    },
    {
      id: "messenger",
      title: "최근 대화",
      value: "준비 중",
      subtext: "최근 대화를 중심으로 실시간 협업 상태를 확인합니다.",
      tone: "sand" as const,
    },
    {
      id: "alerts",
      title: "오늘 알림",
      value: `${dashboardStats.unreadCount}건`,
      subtext: `미확인 ${dashboardStats.unreadCount}건, 긴급 ${dashboardStats.urgentCount}건`,
      tone: "rose" as const,
    },
  ].sort((left, right) => {
    const leftIndex = uiContract.homeCardOrder.indexOf(left.id);
    const rightIndex = uiContract.homeCardOrder.indexOf(right.id);
    const safeLeft = leftIndex === -1 ? 999 : leftIndex;
    const safeRight = rightIndex === -1 ? 999 : rightIndex;
    return safeLeft - safeRight;
  });

  const visibleMailList = getMailListByFolder(activeMailFolder);
  const localMailArchiveHint = activeMailFolder === "localArchive" ? "설치형 로컬 아카이브 연동 경로로 이동해 보관된 메일을 확인하세요." : "";
  const starredMailCount = [...inboxMails, ...sentMails].filter((item) => item.isStarred).length;
  const draftMailCount = [...inboxMails, ...sentMails].filter((item) => item.status === "draft").length;
  const unreadInboxCount = inboxMails.filter((item) => !item.isRead).length;
  const selectedMailSummary =
    visibleMailList.find((item) => item.mailId === selectedMailId) ??
    inboxMails.find((item) => item.mailId === selectedMailId) ??
    sentMails.find((item) => item.mailId === selectedMailId) ??
    null;

  function handleHomeSurfaceCardClick(surfaceCardId: string) {
    if (surfaceCardId === "mail") {
      setPortalMenu("mail");
      return;
    }
    if (surfaceCardId === "approval") {
      setPortalMenu("approval");
      return;
    }
    if (surfaceCardId === "messenger") {
      setPortalMenu("messenger");
      return;
    }
    if (surfaceCardId === "alerts") {
      setPortalMenu("alerts");
    }
  }

  const mailBuckets = [
    { title: "안 읽은 메일", count: `${unreadInboxCount}건`, note: "받은편지함 기준 읽지 않은 메일 우선 확인" },
    { title: "중요 메일", count: `${starredMailCount}건`, note: "별표 처리된 메일을 공통 우선순위로 유지" },
    { title: "임시보관", count: `${draftMailCount}건`, note: "작성 중 메일과 임시저장 메일 현황" },
    { title: "로컬 아카이브", count: "설치형 연결", note: "장기 보관 메일은 설치형 아카이브로 이동" },
  ];

  const mailFolders = [
    { title: "받은편지함", count: `${inboxMails.length}`, tone: "#0f766e", folder: "inbox" as MailFolderType },
    { title: "보낸편지함", count: `${sentMails.length}`, tone: "#334155", folder: "sent" as MailFolderType },
    { title: "중요 메일", count: `${starredMailCount}`, tone: "#b45309", folder: "starred" as MailFolderType },
    { title: "안 읽은 메일", count: `${unreadInboxCount}`, tone: "#1d4ed8", folder: "unread" as MailFolderType },
    { title: "임시보관함", count: `${draftMailCount}`, tone: "#7c3aed", folder: "draft" as MailFolderType },
    { title: "설치형 로컬 아카이브", count: "연결", tone: "#14532d", folder: "localArchive" as MailFolderType },
  ];

  const mailListSamples = visibleMailList.map((item) => ({
    mailId: item.mailId,
    sender: item.senderEmail,
    subject: item.subject,
    preview:
      selectedMailId === item.mailId
        ? summarizeMailPreview(selectedMailDetail, item.subject)
        : item.subject,
    time: formatDateLabel(item.receivedAt || item.sentAt),
    unread: !item.isRead,
    important: item.isStarred,
    attachment: item.attachmentCount > 0,
  }));

  const mailStatusMessages = [
    { title: "빈 상태", body: uiContract.messages.empty, tone: "#475569" },
    { title: "오류 상태", body: mailError || uiContract.messages.error, tone: "#b91c1c" },
    { title: "권한 없음", body: uiContract.messages.permissionDenied, tone: "#9f1239" },
    { title: "세션 만료", body: uiContract.messages.sessionExpired, tone: "#92400e" },
    { title: "보관 경로", body: "장기 보관 메일은 설치형 로컬 아카이브에서 확인합니다.", tone: "#14532d" },
  ];

  const approvalBuckets = [
    { title: "초안", count: documents.filter((doc) => doc.status === "draft").length, tone: "#475569" },
    { title: "상신", count: documents.filter((doc) => doc.status === "submitted").length, tone: "#0f766e" },
    { title: "반려", count: documents.filter((doc) => doc.status === "rejected").length, tone: "#9f1239" },
    { title: "완료", count: documents.filter((doc) => doc.status === "approved").length, tone: "#14532d" },
  ];

  const messengerBuckets = [
    { title: "최근 대화", note: `${messengerRoomsData.length}개 대화방과 읽지 않음 메시지 우선` },
    { title: "즐겨찾기 채널", note: `${messengerRoomsData.filter((item) => item.unreadCount > 0).length}개 채널이 읽지 않음 상태` },
    { title: "첨부 / 링크", note: "파일, 링크, 회의록을 대화와 같은 흐름에서 확인" },
    { title: "로컬 파일 보관", note: "상세 보관은 설치형 클라이언트의 대화 파일 흐름으로 연결" },
  ];

  const messengerRooms = [
    {
      title: "최근 대화",
      entries: messengerRoomsData.slice(0, 5).map((item) => `${item.roomName}${item.unreadCount ? ` (${item.unreadCount})` : ""}`),
    },
    {
      title: "읽지 않음 우선",
      entries: messengerRoomsData.filter((item) => item.unreadCount > 0).slice(0, 5).map((item) => `${item.roomName} (${item.unreadCount})`),
    },
    {
      title: "전체 대화방",
      entries: messengerRoomsData.slice(0, 6).map((item) => item.roomName),
    },
  ].filter((group) => group.entries.length > 0);

  const messengerTimeline = roomMessages.map((item) => ({
    sender: item.senderUserName,
    time: formatDateLabel(item.createdAt),
    body: item.body,
    meta: `읽음 ${item.readBy.length} · ${item.readState}`,
  }));

  const collaborationPanels = [
    {
      title: "참여자 목록",
      body: selectedRoomDetail?.participants.map((item) => item.userName).join(", ") || uiContract.messages.empty,
    },
    {
      title: "최근 메시지 상태",
      body: roomMessages[roomMessages.length - 1]?.readState || "메시지 없음",
    },
    {
      title: "보관 정책",
      body: "메신저 서버 2주 보관 / 장기 보관은 설치형 대화 파일 저장으로 연결",
    },
    {
      title: "대화방 ID",
      body: selectedRoomDetail?.roomId || "-",
    },
  ];

  const messageScopes = [
    { title: "빈 상태", sample: uiContract.messages.empty, tone: "#475569" },
    { title: "오류 메시지", sample: notificationError || approvalError || uiContract.messages.error, tone: "#b91c1c" },
    { title: "차단 메시지", sample: uiContract.messages.blocked, tone: "#9f1239" },
    { title: "경고 메시지", sample: uiContract.messages.warning, tone: "#9a3412" },
    { title: "성공 메시지", sample: message || uiContract.messages.success, tone: "#166534" },
  ];

  const contactDirectory = useMemo(() => {
    const rows: Array<{ name: string; email: string; department: string; role: string; state: "온라인" | "오프라인" }> = [];
    if (me) {
      rows.push({
        name: me.userName,
        email: me.userEmail,
        department: "현재 조직",
        role: me.roleName || "역할 미지정",
        state: "온라인",
      });
    }
    messengerRoomsData.forEach((room) => {
      rows.push({
        name: room.roomName,
        email: "",
        department: "공유 대화방",
        role: `참여자 ${room.participantIds.length}명`,
        state: "오프라인",
      });
    });
    return rows.slice(0, 12);
  }, [me, messengerRoomsData]);

  const organizationTree = useMemo(() => {
    const root = {
      department: "조직도",
      users: contactDirectory.filter((item) => item.department === "현재 조직").map((item) => item.name),
    };
    if (root.users.length === 0) {
      return [{ department: "조직도", users: ["현재 조직 데이터를 불러오는 중입니다."] }];
    }
    return [root];
  }, [contactDirectory]);

  const fileHubItems = useMemo(
    () =>
      [
        ...inboxMails
          .filter((item) => item.attachmentCount > 0)
          .slice(0, 4)
          .map((item) => ({
            type: "메일 첨부",
            title: item.subject || item.mailId,
            source: item.senderEmail,
            count: `${item.attachmentCount}개`,
            key: `mail-${item.mailId}`,
          })),
        ...sentMails
          .filter((item) => item.attachmentCount > 0)
          .slice(0, 4)
          .map((item) => ({
            type: "결재 첨부",
            title: item.subject || item.mailId,
            source: item.senderEmail,
            count: `${item.attachmentCount}개`,
            key: `approval-${item.mailId}`,
          })),
        ...roomMessages
          .filter((item) => item.attachmentMeta.length > 0)
          .slice(0, 4)
          .map((item) => ({
            type: "메신저 공유",
            title: item.body.slice(0, 28) || "미리보기 없음",
            source: item.senderUserName,
            count: `첨부 ${item.attachmentMeta.length}개`,
            key: `message-${item.senderUserId}-${item.createdAt}-${item.messageId}`,
          })),
      ]
        .filter((item) => item.count !== "0개")
      .slice(0, 12),
    [inboxMails, sentMails, roomMessages],
  );

  useEffect(() => {
    if (!token) {
      setSelectedContactEmail("");
      setSelectedOrgMember("");
      setSelectedFileId("");
      return;
    }
    if (contactDirectory.length > 0) {
      const hasSelectedContact = contactDirectory.some((item) =>
        (item.email ? item.email === selectedContactEmail : `${item.name}-${item.department}` === selectedContactEmail),
      );
      if (!hasSelectedContact) {
        const first = contactDirectory[0];
        setSelectedContactEmail(first.email || `${first.name}-${first.department}`);
      }
    } else {
      setSelectedContactEmail("");
    }
    const hasOrgMember = organizationTree.some((department) => department.users.includes(selectedOrgMember));
    if (!hasOrgMember) {
      setSelectedOrgMember(organizationTree[0]?.users[0] || "");
    }
    if (fileHubItems.length > 0) {
      const hasFile = fileHubItems.some((item) => item.key === selectedFileId);
      if (!hasFile) {
        setSelectedFileId(fileHubItems[0]?.key || "");
      }
    } else {
      setSelectedFileId("");
    }
  }, [token, contactDirectory, organizationTree, fileHubItems, selectedContactEmail, selectedOrgMember, selectedFileId]);

  const selectedContact =
    contactDirectory.find((item) => item.email === selectedContactEmail) ?? contactDirectory[0] ?? null;

  const selectedOrganizationMember = selectedOrgMember || organizationTree[0]?.users[0] || "";

  const selectedFileItem = fileHubItems.find((item) => item.key === selectedFileId) ?? fileHubItems[0] ?? null;

  const brandPalette = [
    { title: "대표 색상", value: "#0f766e", usage: "상단 바, 주요 버튼, 핵심 배지" },
    { title: "보조 색상", value: "#1f2937", usage: "사이드바, 문서 헤더, 기본 업무 톤" },
    { title: "강조 색상", value: "#9a6b2f", usage: "메일/메신저 보조 포인트, 고정 영역" },
    { title: "차단 색상", value: "#9f1239", usage: "차단, 긴급, 강한 주의 상태" },
  ];

  const componentRules = [
    { title: "카드", body: "둥근 모서리 + 얕은 그림자 + 상단 킥커 조합으로 제품군 공통 카드 톤을 유지" },
    { title: "버튼", body: "주요 액션은 청록 계열, 보조 액션은 흰 배경 + 회색 경계선으로 통일" },
    { title: "배지", body: "상태/카테고리 배지는 pill 형태와 12~13px 굵은 텍스트로 통일" },
    { title: "탭", body: "활성 탭은 대표 색상 채움, 비활성 탭은 흰 바탕 + 연한 경계선으로 통일" },
  ];

  const statusVisualRules = [
    { title: "성공", body: "처리 완료, 저장 완료, 읽음 처리 완료", bg: "#ecfeff", border: "#99f6e4", color: "#0f766e" },
    { title: "정보", body: "안내, 정책 경로, 기본 참고 메시지", bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
    { title: "경고", body: "재검토 필요, 설정 확인, 누락 점검", bg: "#fff7ed", border: "#fed7aa", color: "#b45309" },
    { title: "오류", body: "요청 실패, 불러오기 실패, 네트워크 문제", bg: "#fff1f2", border: "#fecdd3", color: "#b91c1c" },
    { title: "차단", body: "세션 만료, 권한 없음, 접근 제한", bg: "#fdf2f8", border: "#fbcfe8", color: "#9f1239" },
    { title: "비활성", body: "아직 데이터 없음, 대기, 사용 불가", bg: "#f8fafc", border: "#cbd5e1", color: "#64748b" },
  ];
  const settingsContractCards = [
    { title: "브랜드 설정 반영", body: "상단 바, 좌측 메뉴, 주요 버튼, 상태 박스가 관리자 브랜드 값 기준으로 움직입니다." },
    { title: "메뉴 순서 반영", body: "메일, 결재, 메신저, 설정 메뉴 순서와 홈 카드 우선순위가 운영 설정 계약을 공유합니다." },
    { title: "메시지 묶음 반영", body: "오류, 경고, 차단, 빈 상태, 성공, 세션 만료 메시지가 같은 운영 메시지 계약을 따릅니다." },
    { title: "정책 안내 반영", body: "정책 본문은 직접 노출하지 않고 Help / 정책 안내 / 설정 > 보관 정책 경로만 공통 유지합니다." },
  ];

  if (token) {
    const portalMenus: Array<{ key: UserPortalMenu; label: string; desc: string }> = [
      { key: "home", label: "홈", desc: "오늘 업무 우선순위" },
      { key: "mail", label: "메일", desc: `${notificationSummary?.unreadCount ?? 0}건 확인` },
      { key: "approval", label: "결재", desc: `${dashboardStats.pendingApprovals}건 대기` },
      { key: "messenger", label: "메신저", desc: "최근 대화" },
      { key: "schedule", label: "일정", desc: "오늘 일정" },
      { key: "contacts", label: "주소록", desc: "연락처" },
      { key: "org", label: "조직도", desc: "부서/역할" },
      { key: "files", label: "파일", desc: "업무 파일" },
      { key: "alerts", label: "알림", desc: `${dashboardStats.unreadCount}건` },
      { key: "settings", label: "설정", desc: "언어/화면" },
      { key: "help", label: "Help / 정책", desc: "정책 경로" },
    ];

    const renderWorkPanel = () => {
      if (activePortalMenu === "mail") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "240px minmax(320px, 0.9fr) minmax(360px, 1.1fr)", gap: 18, minHeight: 0 }}>
            <aside style={{ display: "grid", gap: 10, alignContent: "start", overflowY: "auto" }}>
              {mailFolders.map((item) => (
            <button
                  key={item.title}
                  type="button"
                  onClick={() => {
                    setMailFolder(item.folder);
                    const workspaceMailbox: MailboxType = item.folder === "sent" ? "sent" : "inbox";
                    if (item.folder === "localArchive") {
                      setSelectedMailId("");
                      setSelectedMailDetail(null);
                    }
                    void loadMailWorkspace(token, workspaceMailbox);
                  }}
                  style={{
                    borderRadius: 18,
                    padding: 16,
                    border: activeMailFolder === item.folder ? `1px solid ${item.tone}` : "1px solid #dbe4ec",
                    background: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <strong>{item.title}</strong>
                  <div style={{ marginTop: 8, color: item.tone, fontWeight: 800 }}>{item.count}</div>
                </button>
              ))}
            </aside>
            <section style={{ display: "grid", gap: 10, alignContent: "start", overflowY: "auto" }}>
              {activeMailFolder === "localArchive" ? (
                <article style={{ borderRadius: 20, padding: 18, border: "1px solid #dbe4ec", background: "#fff", color: "#334155", lineHeight: 1.7 }}>
                  {mailLoading
                    ? "로컬 아카이브를 동기화하고 있습니다."
                    : "로컬 아카이브는 설치형 클라이언트의 장기 보관 경로로 연동되며, 현재는 파일 연계 상태 확인만 지원합니다."}
                </article>
              ) : (
                <>
                  {mailListSamples.map((item) => (
                    <button
                      key={item.mailId}
                      type="button"
                      onClick={() => {
                        const mailbox = inferMailboxFromMailId(item.mailId);
                        void selectMail(token, item.mailId, mailbox, { markRead: mailbox === "inbox" });
                      }}
                      style={{
                        borderRadius: 20,
                        padding: 16,
                        border: selectedMailId === item.mailId ? `1px solid ${uiContract.brand.primary}` : "1px solid #dbe4ec",
                        background: item.unread ? "#f8fafc" : "#fff",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <strong>{item.sender}</strong>
                        <span style={{ color: "#64748b", fontSize: 13 }}>{item.time}</span>
                      </div>
                      <h3 style={{ margin: "8px 0 6px", fontSize: 18 }}>{item.subject}</h3>
                      <p style={{ margin: 0, color: "#475569", lineHeight: 1.55 }}>{item.preview}</p>
                    </button>
                  ))}
                  {mailListSamples.length === 0 ? (
                    <article style={{ borderRadius: 20, padding: 18, border: "1px dashed #cbd5e1", color: "#64748b", background: "#fff" }}>
                      {mailLoading ? "메일을 불러오는 중입니다." : uiContract.messages.empty}
                    </article>
                  ) : null}
                </>
              )}
            </section>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 상세</div>
              <h2 style={{ margin: "10px 0 0", fontSize: 28 }}>{selectedMailDetail?.subject || "메일을 선택하세요"}</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>
                {selectedMailDetail
                  ? selectedMailDetail.bodyText || selectedMailDetail.subject
                  : "받은편지함 또는 보낸편지함 목록에서 메일을 선택하면 상세 본문을 확인할 수 있습니다."}
              </p>
              <p style={{ color: "#64748b", fontSize: 14 }}>
                발신자 {selectedMailDetail?.senderEmail || "-"} / 수신 {selectedMailDetail?.recipients.map((item) => item.recipientEmail).join(", ") || "-"}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedMailId) {
                      const mailbox = inferMailboxFromMailId(selectedMailId);
                      void selectMail(token, selectedMailId, mailbox, { markRead: mailbox === "inbox" });
                    }
                  }}
                  style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13, border: 0, cursor: "pointer" }}
                >
                  읽음 처리
                </button>
                <button
                  type="button"
                  onClick={() => void toggleSelectedMailStar()}
                  style={{ padding: "9px 12px", borderRadius: 999, background: "#fff7ed", color: "#b45309", fontWeight: 700, fontSize: 13, border: 0, cursor: "pointer" }}
                >
                  중요 표시
                </button>
                <span style={{ padding: "9px 12px", borderRadius: 999, background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 13 }}>
                  첨부 {selectedMailDetail?.attachmentCount ?? 0}
                </span>
                <span style={{ padding: "9px 12px", borderRadius: 999, background: "#f0fdf4", color: "#166534", fontWeight: 700, fontSize: 13 }}>
                  {selectedMailDetail ? (inferMailboxFromMailId(selectedMailId || selectedMailDetail.mailId) === "sent" ? "보낸편지함" : "받은편지함") : localMailArchiveHint || "받은편지함"}
                </span>
                {activeMailFolder === "localArchive" ? (
                  <span style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
                    {localMailArchiveHint}
                  </span>
                ) : null}
              </div>
              {mailError ? <p style={{ color: "#b91c1c", marginTop: 14 }}>{mailError}</p> : null}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "contacts") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "280px minmax(420px, 1fr)", gap: 18, minHeight: 0 }}>
            <aside style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>주소록 요약</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>부서/즐겨찾기/최근 연락처</h3>
              {contactDirectory.length === 0 ? <div style={{ marginTop: 14, color: "#64748b" }}>{uiContract.messages.empty}</div> : null}
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {contactDirectory.map((item) => (
                  <button
                    key={`${item.name}-${item.email || item.department}`}
                    type="button"
                    onClick={() => setSelectedContactEmail(item.email || `${item.name}-${item.department}`)}
                    style={{ padding: 16, border: "1px solid #dbe4ec", borderRadius: 16, background: "#f8fafc", textAlign: "left", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 800 }}>{item.name}</div>
                    <div style={{ color: "#475569", marginTop: 6 }}>{item.email || "내부 채널"} / {item.department} / {item.role}</div>
                    <div style={{ color: item.state === "온라인" ? "#166534" : "#64748b", marginTop: 8, fontWeight: 700 }}>{item.state}</div>
                  </button>
                ))}
              </div>
            </aside>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>연락처 상세</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>최근 선택 항목으로 이동</h3>
              {selectedContact ? (
                <ul style={{ margin: 0, paddingLeft: 20, color: "#334155", lineHeight: 1.8 }}>
                  <li>최근 사용 대상: {selectedContact.name}</li>
                  <li>이메일: {selectedContact.email || "내부 채널"}</li>
                  <li>부서: {selectedContact.department}</li>
                  <li>역할: {selectedContact.role}</li>
                  <li>상태: {selectedContact.state}</li>
                  <li>표시 기준: 현재 세션 기반 사용자 + 대화방 대표</li>
                  <li>도움말: 클릭 동작은 상세 페이지로 확장 가능합니다.</li>
                </ul>
              ) : (
                <p style={{ color: "#64748b" }}>표시할 주소록 데이터가 없습니다.</p>
              )}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "org") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>조직 트리</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>부서/권한 요약</h3>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {organizationTree.map((item) => (
                  <div key={item.department} style={{ border: "1px solid #dbe4ec", borderRadius: 16, padding: 14, background: "#f8fafc" }}>
                    <strong>{item.department}</strong>
                    <div style={{ marginTop: 8 }}>
                      {item.users.map((userName, index) => (
                        <button
                          key={`${item.department}-${userName}-${index}`}
                          type="button"
                          onClick={() => setSelectedOrgMember(userName)}
                          style={{ width: "100%", border: 0, background: "#fff", borderRadius: 10, padding: "6px 10px", textAlign: "left", color: "#334155" }}
                        >
                          {userName}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>권한 요약</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>역할/권한 동기화</h3>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>
                사용자 역할: {me?.roleName || "미지정"} / 회사: {me?.companyId || "알 수 없음"} / 이메일: {me?.userEmail || "미설정"}
              </p>
              <p style={{ color: "#64748b" }}>선택 사용자: {selectedOrganizationMember || "미지정"} / 권한 변경은 관리자 콘솔에서 반영되며 사용자 웹은 상태를 즉시 반영합니다.</p>
              <p style={{ color: "#64748b" }}>권한 상태: {selectedOrgMember ? "직접 선택됨" : "기본 상태"} </p>
            </article>
          </section>
        );
      }

      if (activePortalMenu === "files") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>최근 파일</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>메일 첨부 / 결재 첨부 / 메신저 공유</h3>
              {fileHubItems.length > 0 ? (
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {fileHubItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedFileId(item.key)}
                      style={{ border: "1px solid #dbe4ec", borderRadius: 16, padding: 14, background: selectedFileId === item.key ? "#e0f2fe" : "#f8fafc", color: "#334155", textAlign: "left" }}
                    >
                      <div style={{ fontWeight: 800 }}>{item.type}</div>
                      <div>{item.title}</div>
                      <div style={{ marginTop: 8, color: "#64748b" }}>
                        출처: {item.source} / {item.count}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>{uiContract.messages.empty}</p>
              )}
            </article>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>로컬 보관 연계</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>설치형 로컬 아카이브</h3>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>
                결재 첨부/메일 첨부/메신저 공유 항목은 로컬 정책(설치형 무기한 보관)과 연계된 보관 경로로 전달할 수 있게 구성합니다.
              </p>
              <p style={{ color: "#334155", fontWeight: 800 }}>{MAIL_POLICY.localRetention}</p>
              <p style={{ color: "#334155", fontWeight: 800 }}>{MESSENGER_POLICY.localRetention}</p>
              {selectedFileItem ? (
                <div style={{ marginTop: 14, border: "1px solid #dbe4ec", borderRadius: 16, padding: 14, background: "#f8fafc" }}>
                  <div style={{ fontWeight: 800 }}>{selectedFileItem.type}</div>
                  <div>{selectedFileItem.title}</div>
                  <div style={{ marginTop: 8, color: "#64748b" }}>출처: {selectedFileItem.source}</div>
                  <div style={{ marginTop: 4, color: "#64748b" }}>수량: {selectedFileItem.count}</div>
                </div>
              ) : null}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "approval") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "minmax(360px, 0.9fr) minmax(420px, 1.1fr)", gap: 18, minHeight: 0 }}>
            <div style={{ display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                {approvalBuckets.map((item) => (
                  <article key={item.title} style={{ borderRadius: 18, padding: 16, border: "1px solid #dbe4ec", background: "#fff" }}>
                    <div style={{ color: item.tone, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800 }}>{item.count}</div>
                  </article>
                ))}
              </div>
              {documents.slice(0, 8).map((doc) => (
                <article key={doc.id} style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: doc.status === "submitted" ? "#f8fafc" : "#fff" }}>
                  <strong>{doc.title}</strong>
                  <p style={{ margin: "8px 0 0", color: "#475569" }}>{doc.status} / 작성자 {doc.creatorUserName}</p>
                </article>
              ))}
              {documents.length === 0 ? <article style={{ borderRadius: 20, padding: 18, border: "1px dashed #cbd5e1", color: "#64748b" }}>아직 문서가 없습니다.</article> : null}
            </div>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>결재 처리</div>
              <h2 style={{ margin: "10px 0 0", fontSize: 28 }}>대기 결재와 빠른 작성</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>상신, 승인, 반려, 회수, 재기안은 서버 상태 전이 규칙에 따라 처리합니다. 상세 문서가 길면 이 패널 내부에서만 스크롤됩니다.</p>
              {uiContract.quickComposeVisible ? (
                <form onSubmit={handleCreate} style={{ display: "grid", gap: 12, marginTop: 18 }}>
                  <input value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} placeholder="결재 제목" style={{ height: 46, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px" }} />
                  <textarea value={createForm.content} onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))} placeholder="내용" style={{ minHeight: 110, borderRadius: 16, border: "1px solid #cbd5e1", padding: 14 }} />
                  <input value={createForm.approverUserIds} onChange={(event) => setCreateForm((current) => ({ ...current, approverUserIds: event.target.value }))} placeholder="결재자 사용자 ID" style={{ height: 46, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px" }} />
                  <button disabled={loading || !canAct.create} style={{ height: 48, borderRadius: 16, border: 0, background: uiContract.brand.primary, color: "#fff", fontWeight: 800 }}>결재 초안 저장</button>
                </form>
              ) : null}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "messenger") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "280px minmax(420px, 1fr) 280px", gap: 18, minHeight: 0 }}>
            <aside style={{ display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
              {messengerRoomsData.map((room) => (
                <button
                  key={room.roomId}
                  type="button"
                  onClick={() => void selectMessengerRoom(token, room.roomId, { markRead: true })}
                  style={{
                    borderRadius: 20,
                    padding: 16,
                    border: selectedRoomId === room.roomId ? `1px solid ${uiContract.brand.primary}` : "1px solid #dbe4ec",
                    background: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <strong>{room.roomName}</strong>
                  <p style={{ margin: "8px 0 0", color: "#475569" }}>{room.lastMessage || "최근 메시지가 없습니다."}</p>
                  <div style={{ marginTop: 8, color: room.unreadCount > 0 ? "#b91c1c" : "#64748b", fontSize: 13, fontWeight: 700 }}>
                    미읽음 {room.unreadCount} · {formatDateLabel(room.lastMessageAt || room.updatedAt)}
                  </div>
                </button>
              ))}
              {messengerRoomsData.length === 0 ? (
                <article style={{ borderRadius: 20, padding: 18, border: "1px dashed #cbd5e1", color: "#64748b", background: "#fff" }}>
                  {messengerLoading ? "대화방을 불러오는 중입니다." : uiContract.messages.empty}
                </article>
              ) : null}
            </aside>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>대화 타임라인</div>
              <h2 style={{ margin: "10px 0 0", fontSize: 28 }}>{selectedRoomDetail?.roomName || "대화방을 선택하세요"}</h2>
              {messengerTimeline.map((item) => (
                <div key={`${item.sender}-${item.time}`} style={{ marginTop: 12, padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                  <strong>{item.sender}</strong>
                  <span style={{ marginLeft: 10, color: "#64748b", fontSize: 13 }}>{item.time}</span>
                  <p style={{ color: "#334155", lineHeight: 1.6 }}>{item.body}</p>
                  <div style={{ color: "#0f766e", fontSize: 13, fontWeight: 700 }}>{item.meta}</div>
                </div>
              ))}
              {messengerTimeline.length === 0 ? <p style={{ color: "#64748b" }}>{uiContract.messages.empty}</p> : null}
              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <textarea
                  value={messengerDraft}
                  onChange={(event) => setMessengerDraft(event.target.value)}
                  placeholder="메시지를 입력하세요."
                  style={{ minHeight: 88, borderRadius: 16, border: "1px solid #cbd5e1", padding: 14 }}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => void handleMessengerSend()}
                    disabled={messengerLoading || !selectedRoomId || !messengerDraft.trim()}
                    style={{ height: 44, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 16px", fontWeight: 800, cursor: "pointer" }}
                  >
                    메시지 전송
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRoomId) {
                        void selectMessengerRoom(token, selectedRoomId, { markRead: true });
                      }
                    }}
                    disabled={!selectedRoomId}
                    style={{ height: 44, borderRadius: 14, border: "1px solid #cbd5e1", background: "#fff", padding: "0 16px", fontWeight: 700, cursor: "pointer" }}
                  >
                    읽음 처리
                  </button>
                </div>
              </div>
              {messengerError ? <p style={{ color: "#b91c1c", marginTop: 14 }}>{messengerError}</p> : null}
            </article>
            <aside style={{ display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
              {collaborationPanels.map((item) => (
                <article key={item.title} style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: "#fff" }}>
                  <strong>{item.title}</strong>
                  <p style={{ color: "#475569", lineHeight: 1.6 }}>{item.body}</p>
                </article>
              ))}
            </aside>
          </section>
        );
      }

      if (activePortalMenu === "alerts") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "minmax(420px, 1fr) 320px", gap: 18, minHeight: 0 }}>
            <div style={{ display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
              {notifications.slice(0, 12).map((item) => (
                <article key={item.notificationId} style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: item.status === "unread" ? "#f8fafc" : "#fff" }}>
                  <strong>{item.title}</strong>
                  <p style={{ color: "#475569", lineHeight: 1.6 }}>{item.message}</p>
                  <button type="button" onClick={() => void executeAck(item.notificationId)} disabled={loading || item.status !== "unread"} style={{ height: 38, borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", padding: "0 12px" }}>읽음 처리</button>
                </article>
              ))}
              {notifications.length === 0 ? <article style={{ borderRadius: 20, padding: 18, border: "1px dashed #cbd5e1", color: "#64748b" }}>아직 표시할 알림이 없습니다.</article> : null}
            </div>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff" }}>
              <h2 style={{ marginTop: 0 }}>알림 정책</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>현재 모드: {notificationMode === "streaming" ? "SSE" : notificationMode === "fallback" ? "Polling Fallback" : "Polling"}</p>
              {notificationError ? <p style={{ color: "#b91c1c" }}>{notificationError}</p> : null}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "settings" || activePortalMenu === "help") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18, minHeight: 0, overflowY: "auto" }}>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff" }}>
              <h2 style={{ marginTop: 0 }}>Help / 정책 안내</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>정책 본문은 업무 홈에 직접 노출하지 않고 {uiContract.helpText} 경로에서 확인합니다.</p>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>메일: {MAIL_POLICY.serverRetention} / {MAIL_POLICY.localRetention}</p>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>메신저: {MESSENGER_POLICY.serverRetention} / {MESSENGER_POLICY.localRetention}</p>
            </article>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff" }}>
              <h2 style={{ marginTop: 0 }}>설정 반영</h2>
              {settingsContractCards.map((item) => (
                <div key={item.title} style={{ marginTop: 12, padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                  <strong>{item.title}</strong>
                  <p style={{ marginBottom: 0, color: "#475569", lineHeight: 1.6 }}>{item.body}</p>
                </div>
              ))}
            </article>
          </section>
        );
      }

      return (
        <section style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 18, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
            {homeSurfaceCards.map((item) => (
              <SurfaceCard
                key={item.id}
                title={item.title}
                value={item.value}
                subtext={item.subtext}
                tone={item.tone}
                onClick={token ? () => handleHomeSurfaceCardClick(item.id) : undefined}
              />
            ))}
          </div>
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
            <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>오늘 업무</div>
            <h2 style={{ margin: "10px 0 0", fontSize: 30 }}>업무 카드에서 바로 처리하세요</h2>
            <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
                {[
                  { title: "메일", description: "받은편지함, 중요메일, 임시보관함", key: "mail" as UserPortalMenu },
                  { title: "결재", description: "대기 결재, 신규 상신, 반려 재기안", key: "approval" as UserPortalMenu },
                  { title: "메신저", description: "최근 대화, 고정 채널, 파일 링크", key: "messenger" as UserPortalMenu },
                  { title: "오늘 일정", description: "회의와 마감 확인", key: "schedule" as UserPortalMenu },
                  { title: "공지", description: "운영 공지와 팀 알림", key: "alerts" as UserPortalMenu },
                  { title: "즐겨찾기", description: "자주 쓰는 업무 바로가기", key: "files" as UserPortalMenu },
                ].map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => setPortalMenu(item.key)}
                    style={{ textAlign: "left", borderRadius: 20, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 18, color: "#0f172a", cursor: "pointer" }}
                  >
                    <strong style={{ fontSize: 18 }}>{item.title}</strong>
                    <p style={{ margin: "8px 0 0", color: "#475569", lineHeight: 1.55 }}>{item.description}</p>
                  </button>
                ))}
              </div>
            </article>
            <aside style={{ display: "grid", gap: 14, alignContent: "start", overflowY: "auto" }}>
              <article style={{ borderRadius: 24, padding: 20, background: "linear-gradient(135deg, #f0fdfa, #ecfeff)", border: "1px solid #99f6e4" }}>
                <strong>{me?.userName}</strong>
                <p style={{ margin: "8px 0 0", color: "#334155" }}>{me?.roleName || "역할 미지정"} / {me?.userEmail}</p>
              </article>
              <article style={{ borderRadius: 24, padding: 20, background: "#fff", border: "1px solid #dbe4ec" }}>
                <strong>알림 센터</strong>
                <p style={{ color: "#475569" }}>읽지 않은 알림 {dashboardStats.unreadCount}건 / 긴급 {dashboardStats.urgentCount}건</p>
                <button type="button" onClick={() => setPortalMenu("alerts")} style={{ height: 42, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 14px", fontWeight: 800 }}>알림 열기</button>
              </article>
              <button onClick={() => { clearUserToken(); setToken(""); setMe(null); }} style={{ height: 48, borderRadius: 16, border: 0, background: "#0f172a", color: "#fff", fontWeight: 800 }}>로그아웃</button>
            </aside>
          </section>
        </section>
      );
    };

    const quickComposeTargets = [
      {
        mode: "mail" as QuickComposeMode,
        label: "메일 작성",
        description: "메일 작성 화면으로 이동해 새 메일 작성 시작.",
      },
      {
        mode: "approval" as QuickComposeMode,
        label: "결재 작성",
        description: "결재 문서 초안 작성 화면으로 이동.",
      },
      {
        mode: "messenger" as QuickComposeMode,
        label: "메신저 작성",
        description: "대화방 선택 및 메시지 작성을 위한 메신저 화면으로 이동.",
      },
    ];

    const quickComposePicker = showQuickComposePicker ? (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          display: "grid",
          placeItems: "center",
          background: "rgba(15, 23, 42, 0.45)",
          padding: 20,
        }}
      >
        <div
          style={{
            width: "min(540px, 94vw)",
            borderRadius: 22,
            border: "1px solid #dbe4ec",
            background: "#ffffff",
            padding: 22,
            boxShadow: "0 24px 56px rgba(15, 23, 42, 0.2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>빠른 작성 대상</div>
              <h2 style={{ margin: "8px 0 0", fontSize: 26, lineHeight: 1.2 }}>작업 시작 대상을 선택하세요</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowQuickComposePicker(false);
                setQuickComposeMode("none");
              }}
              style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid #d7e0e8", background: "#fff", fontWeight: 800 }}
            >
              닫기
            </button>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {quickComposeTargets.map((item) => (
              <button
                key={item.mode}
                type="button"
                onClick={() => void openQuickComposeByMode(item.mode)}
                style={{ borderRadius: 16, padding: 14, border: "1px solid #dbe4ec", background: "#f8fafc", textAlign: "left" }}
              >
                <div style={{ fontWeight: 800 }}>{item.label}</div>
                <div style={{ marginTop: 6, color: "#475569" }}>{item.description}</div>
              </button>
            ))}
          </div>
          <p style={{ margin: "14px 0 0", color: "#64748b", fontSize: 13 }}>
            현재 메뉴: {activePortalMenu}
          </p>
        </div>
      </div>
    ) : null;

    return (
      <main
        style={{
          height: "100vh",
          overflow: "hidden",
          background: "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%), linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 20, height: "100%", padding: 24, overflow: "hidden" }}>
          <aside style={{ borderRadius: 30, padding: 22, background: "linear-gradient(180deg, #102a43 0%, #0f172a 100%)", color: "#e2e8f0", overflowY: "auto" }}>
            <div style={{ fontSize: 13, color: "#7dd3fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>MoaWorks Portal</div>
            <h1 style={{ margin: "14px 0 8px", fontSize: 30, lineHeight: 1.08, letterSpacing: "-0.04em" }}>사용자 업무 홈</h1>
            <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.65 }}>업무 처리 중심의 그룹웨어 홈입니다.</p>
            <nav style={{ display: "grid", gap: 8, marginTop: 24 }}>
              {portalMenus.map((item) => (
                <button key={item.key} type="button" onClick={() => setPortalMenu(item.key)} style={{ borderRadius: 16, padding: "12px 14px", border: activePortalMenu === item.key ? "1px solid #7dd3fc" : "1px solid rgba(255,255,255,0.05)", background: activePortalMenu === item.key ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.04)", color: "#e2e8f0", textAlign: "left", cursor: "pointer" }}>
                  <span style={{ display: "block", fontWeight: 800 }}>{item.label}</span>
                  <small style={{ color: "rgba(226,232,240,0.64)" }}>{item.desc}</small>
                </button>
              ))}
            </nav>
          </aside>

          <section style={{ minWidth: 0, height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 16, overflow: "hidden" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 22px", borderRadius: 26, background: "rgba(255,255,255,0.9)", border: "1px solid rgba(148, 163, 184, 0.18)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: uiContract.brand.primary }}>오늘의 업무 허브</div>
                <div style={{ marginTop: 6, fontSize: 30, fontWeight: 900, letterSpacing: "-0.04em" }}>{me?.userName}님, 우선순위를 확인하세요</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="메일, 결재, 대화, 파일 검색" style={{ width: 300, height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px" }} />
                {uiContract.quickComposeVisible ? (
                  <button
                    type="button"
                    onClick={() => void openQuickCompose()}
                    style={{ height: 46, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 16px", fontWeight: 800 }}
                  >
                    빠른 작성
                  </button>
                ) : null}
                <button type="button" onClick={refreshUiContract} style={{ height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px", fontWeight: 700 }}>설정 반영</button>
              </div>
            </header>
            <section style={{ minHeight: 0, overflow: "hidden" }}>{renderWorkPanel()}</section>
          </section>
          {quickComposePicker}
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%), linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
        color: "#0f172a",
        fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
      }}
    >
      {!token ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 1.15fr) minmax(320px, 0.85fr)",
            gap: 28,
            maxWidth: 1360,
            margin: "0 auto",
            padding: "48px 32px 56px",
          }}
        >
          <section
            style={{
              padding: 38,
              borderRadius: 36,
              background: "linear-gradient(145deg, #103b39 0%, #0b1f2a 78%)",
              color: "#f8fafc",
              boxShadow: "0 30px 80px rgba(15, 23, 42, 0.28)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -80,
                top: -80,
                width: 260,
                height: 260,
                borderRadius: 999,
                background: "rgba(153, 246, 228, 0.08)",
              }}
            />
            <div style={{ position: "relative" }}>
              <div
                style={{
                  display: "inline-flex",
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  fontSize: 13,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                MoaWorks Groupware
              </div>
              <h1 style={{ margin: "24px 0 18px", fontSize: 58, lineHeight: 1.05, letterSpacing: "-0.04em" }}>
                메일, 결재, 메신저가 한 화면에서 이어지는
                <br />
                사용자 업무 포털
              </h1>
                <p style={{ margin: 0, maxWidth: 660, color: "rgba(248,250,252,0.82)", fontSize: 18, lineHeight: 1.6 }}>
                  메일, 결재, 메신저를 한 화면에서 바로 이어가는 사용자 포털입니다.
                </p>

              <div
                style={{
                  marginTop: 30,
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                <SurfaceCard
                  title="메일"
                  value="서버 1개월"
                  subtext="중요 메일은 설치형 프로그램에서 로컬 아카이브 무기한 보관을 유지하고, 웹은 빠른 확인과 처리 흐름을 맡습니다."
                  tone="teal"
                />
                <SurfaceCard
                  title="메신저"
                  value="서버 2주"
                  subtext="업무 대화는 웹에서 빠르게 확인하고, 상세 보관은 설치형 프로그램의 JSON/HTML 대화 파일 흐름으로 연결합니다."
                  tone="sand"
                />
              </div>

              <div
                style={{
                  marginTop: 24,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                {[
                  { title: "메일함", value: "안 읽은 메일 / 중요함 / 임시보관함" },
                  { title: "결재", value: "대기 결재 / 상신 / 반려 / 재기안" },
                  { title: "메신저", value: "최근 대화 / 고정 채널 / 파일 링크" },
                ].map((item) => (
                  <div
                    key={item.title}
                    style={{
                      padding: "16px 18px",
                      borderRadius: 24,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{item.title}</div>
                    <div style={{ marginTop: 8, fontSize: 14, color: "rgba(248,250,252,0.76)", lineHeight: 1.6 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gap: 20,
              alignContent: "start",
            }}
          >
            <article
              style={{
                background: "rgba(255,255,255,0.82)",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 30,
                padding: 30,
                boxShadow: "0 24px 60px rgba(15, 23, 42, 0.12)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, color: "#0f766e", fontWeight: 700 }}>사용자 포털 접속</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 34, letterSpacing: "-0.04em" }}>업무 시작</h2>
                </div>
                <p style={{ margin: 0, color: "#115e59", fontSize: 13, fontWeight: 700 }}>설정: 로그인 후 설정 메뉴에서 관리</p>
              </div>

              <form onSubmit={handleLogin} style={{ display: "grid", gap: 14, marginTop: 24 }}>
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>이메일</span>
                  <input
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="user@moaworks.local"
                    style={{
                      height: 54,
                      borderRadius: 16,
                      border: "1px solid #cbd5e1",
                      padding: "0 16px",
                      font: "inherit",
                      background: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>비밀번호</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    style={{
                      height: 54,
                      borderRadius: 16,
                      border: "1px solid #cbd5e1",
                      padding: "0 16px",
                      font: "inherit",
                      background: "#fff",
                    }}
                  />
                </label>
                <button
                  disabled={loading}
                  style={{
                    height: 56,
                    borderRadius: 18,
                    border: 0,
                    background: "linear-gradient(135deg, #0f766e 0%, #14532d 100%)",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: "pointer",
                    boxShadow: "0 18px 36px rgba(15, 118, 110, 0.22)",
                  }}
                >
                  {loading ? "접속 중..." : "업무 포털 로그인"}
                </button>
              </form>
            </article>

            <article
              style={{
                background: "#fff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #e2e8f0",
                boxShadow: "0 22px 44px rgba(15, 23, 42, 0.08)",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.03em" }}>Help / 정책 안내</h3>
              <div
                style={{
                  marginTop: 18,
                  padding: "16px 18px",
                  borderRadius: 20,
                  background: "#f8fafc",
                  border: "1px solid #dbe4ec",
                  color: "#475569",
                  lineHeight: 1.7,
                }}
              >
                정책 본문은 `Help`, `정책 안내`, `설정 &gt; 보관 정책` 경로로만 안내합니다.
              </div>
            </article>

            {approvalError ? (
              <div style={{ color: "#b91c1c", background: "#fff1f2", border: "1px solid #fecdd3", padding: "16px 18px", borderRadius: 18 }}>
                {approvalError}
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px minmax(0, 1fr)",
            gap: 24,
            maxWidth: 1560,
            margin: "0 auto",
            padding: "24px 24px 40px",
          }}
        >
          <aside
            style={{
              position: "sticky",
              top: 24,
              alignSelf: "start",
              borderRadius: 30,
              padding: 24,
              background: "linear-gradient(180deg, #102a43 0%, #0f172a 100%)",
              color: "#e2e8f0",
              boxShadow: "0 24px 64px rgba(15, 23, 42, 0.24)",
            }}
          >
            <div style={{ fontSize: 14, color: "#7dd3fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>MoaWorks Portal</div>
            <h1 style={{ margin: "14px 0 8px", fontSize: 32, lineHeight: 1.08, letterSpacing: "-0.04em" }}>사용자 업무 홈</h1>
            <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.5 }}>
              메일, 결재, 메신저, 알림을 바로 처리하는 업무 홈입니다.
            </p>

            <nav style={{ display: "grid", gap: 10, marginTop: 28 }}>
              {orderedNavItems.map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: 18,
                    padding: "14px 16px",
                    background: item.label === "결재" ? `${uiContract.brand.primary}29` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${item.label === "결재" ? `${uiContract.brand.primary}52` : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{item.label}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "rgba(226,232,240,0.66)", lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </nav>

            <div style={{ marginTop: 26, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 12, color: "#67e8f9", letterSpacing: "0.08em", textTransform: "uppercase" }}>Help / 정책 안내</div>
              <div style={{ marginTop: 12, fontSize: 13, color: "rgba(226,232,240,0.82)", lineHeight: 1.8 }}>
                <div>정책 본문은 메인 업무 화면에서 직접 노출하지 않습니다.</div>
                <div style={{ marginTop: 10 }}>확인 위치: {uiContract.helpText}</div>
              </div>
            </div>
          </aside>

          <section style={{ minWidth: 0 }}>
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                padding: "22px 24px",
                borderRadius: 28,
                background: "rgba(255,255,255,0.88)",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                boxShadow: "0 20px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: uiContract.brand.primary }}>오늘의 업무 허브</div>
                <div style={{ marginTop: 8, fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em" }}>
                  {me?.userName}님, 오늘 우선순위를 확인하세요
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="메일, 결재, 대화, 파일 검색"
                  style={{
                    width: 320,
                    height: 50,
                    borderRadius: 16,
                    border: "1px solid #d7e0e8",
                    background: "#fff",
                    padding: "0 16px",
                    font: "inherit",
                  }}
                />
                {token && uiContract.quickComposeVisible ? (
                  <button
                    type="button"
                    onClick={() => void openQuickCompose()}
                    style={{
                      height: 50,
                      borderRadius: 16,
                      border: 0,
                      padding: "0 18px",
                      background: uiContract.brand.primary,
                      color: "#fff",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    빠른 작성
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={refreshUiContract}
                  style={{
                    height: 50,
                    borderRadius: 16,
                    border: "1px solid #d7e0e8",
                    padding: "0 18px",
                    background: "#fff",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  설정 다시 반영
                </button>
                <div
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "#fff",
                    border: "1px solid #d7e0e8",
                    color: "#334155",
                  }}
                >
                  알림 {dashboardStats.unreadCount}
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "#fff",
                    border: "1px solid #d7e0e8",
                    color: "#334155",
                  }}
                >
                  {me?.roleName}
                </div>
              </div>
            </header>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 18,
                marginTop: 22,
              }}
            >
            {homeSurfaceCards.map((item) => (
                <SurfaceCard
                  key={item.id}
                  title={item.title}
                  value={item.value}
                  subtext={item.subtext}
                  tone={item.tone}
                  onClick={token ? () => handleHomeSurfaceCardClick(item.id) : undefined}
                />
              ))}
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>공통 제품 규칙</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>브랜드 체계 / 공통 컴포넌트 / 상태 표현</h2>
                </div>
                <div style={{ color: "#64748b", fontSize: 14 }}>4개 프로그램이 같은 제품군처럼 읽히는 기준</div>
              </div>

              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {brandPalette.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 16 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 18, background: item.value }} />
                    <div style={{ marginTop: 12, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "#475569" }}>{item.value}</div>
                    <div style={{ marginTop: 8, color: "#64748b", lineHeight: 1.6 }}>{item.usage}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {componentRules.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: "1px solid #dbe4ec", background: "#fff", padding: 16 }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.title}</div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.65 }}>{item.body}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {statusVisualRules.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: `1px solid ${item.border}`, background: item.bg, padding: 16 }}>
                    <div style={{ color: item.color, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 8, color: "#334155", lineHeight: 1.6 }}>{item.body}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {settingsContractCards.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: "1px solid #dbe4ec", background: "#fff", padding: 16 }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.title}</div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.65 }}>{item.body}</div>
                  </div>
                ))}
              </div>
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>핵심 업무 화면</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>메일 / 결재 / 메신저 작업면</h2>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { id: "mail", label: "메일" },
                    { id: "approval", label: "결재" },
                    { id: "messenger", label: "메신저" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveWorkspace(item.id as WorkspaceTab)}
                      style={{
                        height: 42,
                        borderRadius: 999,
                        border: activeWorkspace === item.id ? "0" : "1px solid #cbd5e1",
                        background: activeWorkspace === item.id ? "#0f766e" : "#fff",
                        color: activeWorkspace === item.id ? "#fff" : "#334155",
                        padding: "0 16px",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeWorkspace === "mail" ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.62fr) minmax(320px, 0.9fr) minmax(320px, 1.05fr)", gap: 18, marginTop: 22 }}>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div style={{ padding: 18, borderRadius: 22, background: "#0f172a", color: "#f8fafc" }}>
                      <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.78 }}>메일 폴더</div>
                      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800 }}>폴더 / 보관 흐름</div>
                    </div>
                    {mailFolders.map((item) => (
                      <div key={item.title} style={{ borderRadius: 22, padding: 18, border: "1px solid #dbe4ec", background: "#f8fafc" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <strong style={{ fontSize: 17 }}>{item.title}</strong>
                          <span style={{ color: item.tone, fontWeight: 800 }}>{item.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div style={{ padding: 18, borderRadius: 22, border: "1px solid #dbe4ec", background: "#fff" }}>
                      <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 액션</div>
                      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {["새 메일 작성", "통합 검색", "중요 필터", "미읽음 필터", "첨부 포함 필터"].map((action) => (
                          <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 13 }}>
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                    {mailListSamples.map((item) => (
                      <div key={`${item.sender}-${item.subject}`} style={{ borderRadius: 22, padding: 18, border: "1px solid #dbe4ec", background: item.unread ? "#f8fafc" : "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ fontWeight: 800 }}>{item.sender}</div>
                          <div style={{ fontSize: 13, color: "#64748b" }}>{item.time}</div>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{item.subject}</div>
                        <div style={{ marginTop: 8, color: "#475569", lineHeight: 1.6 }}>{item.preview}</div>
                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ padding: "6px 10px", borderRadius: 999, background: item.unread ? "#dbeafe" : "#e2e8f0", color: item.unread ? "#1d4ed8" : "#475569", fontSize: 12, fontWeight: 800 }}>
                            {item.unread ? "안읽음" : "읽음"}
                          </span>
                          {item.important ? (
                            <span style={{ padding: "6px 10px", borderRadius: 999, background: "#fff7ed", color: "#b45309", fontSize: 12, fontWeight: 800 }}>
                              중요
                            </span>
                          ) : null}
                          {item.attachment ? (
                            <span style={{ padding: "6px 10px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontSize: 12, fontWeight: 800 }}>
                              첨부
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div style={{ borderRadius: 22, padding: 20, border: "1px solid #dbe4ec", background: "#fff" }}>
                      <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 상세 읽기 영역</div>
                      <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>3분기 계약 검토 요청</h3>
                      <div style={{ marginTop: 14, display: "grid", gap: 10, color: "#475569" }}>
                        <div><strong style={{ color: "#0f172a" }}>발신자</strong> 대표이사 &lt;ceo@moaworks.local&gt;</div>
                        <div><strong style={{ color: "#0f172a" }}>수신자</strong> 신산님, 경영지원팀</div>
                        <div><strong style={{ color: "#0f172a" }}>참조</strong> 법무협업, 제품전략</div>
                        <div><strong style={{ color: "#0f172a" }}>첨부</strong> 계약서_v3.pdf, 검토포인트.xlsx</div>
                      </div>
                      <div style={{ marginTop: 16, padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec", color: "#334155", lineHeight: 1.7 }}>
                        오늘 안으로 계약 조항 변경 포인트를 검토해 주세요. 회신이 필요한 항목은 중요 표시 후 바로 답장할 수 있도록 배치했습니다.
                      </div>
                      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {["답장", "전달", "중요 표시", "보관 이동"].map((action) => (
                          <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 18, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
                      Help / 정책 안내 / 설정 &gt; 보관 정책 경로만 유지하고, 메일 화면 본문에는 정책 설명을 직접 넣지 않습니다.
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                      {mailStatusMessages.map((item) => (
                        <div key={item.title} style={{ padding: 16, borderRadius: 18, border: "1px solid #dbe4ec", background: "#f8fafc" }}>
                          <div style={{ fontSize: 12, color: item.tone, fontWeight: 800 }}>{item.title}</div>
                          <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.6 }}>{item.body}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeWorkspace === "approval" ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)", gap: 18, marginTop: 22 }}>
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                      {approvalBuckets.map((item) => (
                        <div key={item.title} style={{ borderRadius: 18, padding: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                          <div style={{ fontSize: 12, color: item.tone, fontWeight: 800 }}>{item.title}</div>
                          <div style={{ marginTop: 8, fontSize: 26, fontWeight: 800 }}>{item.count}</div>
                        </div>
                      ))}
                    </div>
                      <div style={{ borderRadius: 22, padding: 18, background: "#fff", border: "1px solid #dbe4ec" }}>
                        <strong>결재 리스트</strong>
                        <div style={{ marginTop: 8, color: "#475569" }}>초안/상신/승인대기/완료 상태를 탭으로 구분해 확인합니다.</div>
                      </div>
                      <div style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        <strong>최근 결재 활동</strong>
                        <div style={{ marginTop: 8, color: "#475569" }}>최근 감사 이벤트 {logsCount}건을 확인하고 상태 변경까지 이동합니다.</div>
                      </div>
                  </div>
                  <div style={{ borderRadius: 22, padding: 20, background: "#fff", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>결재 상세 보기</div>
                    <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>문서 리스트와 상세 작업을 한 흐름으로</h3>
                      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                        <div style={{ padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                          상태 탭/상세 본문/결재선을 한 화면에서 처리합니다.
                        </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                        {[
                          "결재선: 부장 → 본부장 → 대표",
                          "최근 활동: 상신 09:10 / 검토중",
                          "권한 메시지: 승인 권한 없으면 즉시 차단",
                        ].map((item) => (
                          <div key={item} style={{ padding: 14, borderRadius: 16, background: "#eff6ff", color: "#1d4ed8", fontSize: 13, fontWeight: 700 }}>
                            {item}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {["결재 작성", "상신", "회수", "반려 문서 재기안"].map((action) => (
                          <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeWorkspace === "messenger" ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.7fr) minmax(320px, 1fr) minmax(260px, 0.72fr)", gap: 18, marginTop: 22 }}>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    {messengerRooms.map((group) => (
                      <div key={group.title} style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        <strong>{group.title}</strong>
                        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                          {group.entries.map((entry) => (
                            <div key={entry} style={{ padding: 10, borderRadius: 14, background: "#fff", border: "1px solid #e2e8f0", color: "#334155" }}>
                              {entry}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderRadius: 22, padding: 20, background: "#fff", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>대화 타임라인</div>
                    <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>메시지 / 첨부 / 링크 / 상태 흐름</h3>
                    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                      {messengerTimeline.map((item) => (
                        <div key={`${item.sender}-${item.time}`} style={{ padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <strong>{item.sender}</strong>
                            <span style={{ fontSize: 13, color: "#64748b" }}>{item.time}</span>
                          </div>
                          <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.7 }}>{item.body}</div>
                          <div style={{ marginTop: 10, color: "#0f766e", fontSize: 13, fontWeight: 700 }}>{item.meta}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {["새 대화", "대화 검색", "파일 모아보기", "알림 설정"].map((action) => (
                        <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 13 }}>
                          {action}
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, padding: 16, borderRadius: 18, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
                      타임라인은 로컬 파일 보관 진입만 안내합니다.
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    {collaborationPanels.map((item) => (
                      <div key={item.title} style={{ borderRadius: 22, padding: 18, background: "#fff", border: "1px solid #dbe4ec" }}>
                        <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.title}</div>
                        <div style={{ marginTop: 10, color: "#475569", lineHeight: 1.7 }}>{item.body}</div>
                      </div>
                    ))}
                    {messengerBuckets.map((item) => (
                      <div key={item.title} style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        <strong>{item.title}</strong>
                        <div style={{ marginTop: 8, color: "#475569", lineHeight: 1.65 }}>{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
                gap: 20,
                marginTop: 22,
              }}
            >
              <article
                style={{
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메인 대시보드</div>
                <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>즐겨찾기 업무와 오늘 처리할 일</h2>
              </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 16,
                    marginTop: 22,
                  }}
                >
                  {[
                    {
                      title: "메일",
                      description: "받은편지함, 중요메일, 임시보관함, 개인 로컬 아카이브",
                      badge: "업무 진입 우선",
                    },
                    {
                      title: "결재",
                      description: "대기 결재 확인, 신규 상신, 반려 재기안, 최근 감사 로그",
                      badge: `${dashboardStats.pendingApprovals}건 대기`,
                    },
                    {
                      title: "메신저",
                      description: "최근 대화, 고정 채널, 조직 기반 대화방, 대화 파일 저장",
                      badge: "대화 빠른 확인",
                    },
                    {
                      title: "오늘 일정",
                      description: "일정·회의·마감일을 한 번에 보는 자리",
                      badge: "다음 단계 연동",
                    },
                    {
                      title: "공지",
                      description: "운영 공지, 조직 공지, 팀 공지를 상단 고정 영역으로 배치",
                      badge: "공지 허브",
                    },
                    {
                      title: "즐겨찾기 업무",
                      description: "자주 쓰는 메일함, 결재함, 파일함을 개인화 메뉴로 저장",
                      badge: "사용자 맞춤",
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      style={{
                        borderRadius: 22,
                        padding: 18,
                        background: "#f8fafc",
                        border: "1px solid #dbe4ec",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <strong style={{ fontSize: 18 }}>{item.title}</strong>
                        <span
                          style={{
                            padding: "7px 10px",
                            borderRadius: 999,
                            background: "#ecfeff",
                            color: "#0f766e",
                            fontSize: 12,
                            fontWeight: 700,
                            textAlign: "center",
                          }}
                        >
                          {item.badge}
                        </span>
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.65, fontSize: 14 }}>{item.description}</div>
                    </div>
                  ))}
                </div>
              </article>

              <article
                style={{
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                  display: "grid",
                  gap: 18,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>사용자 / Help</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>프로필과 정책 안내</h2>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    background: "linear-gradient(135deg, #f0fdfa, #ecfeff)",
                    border: "1px solid #99f6e4",
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{me?.userName}</div>
                  <div style={{ marginTop: 6, color: "#334155" }}>
                    {me?.roleName || "역할 미지정"} / {canAct.create ? "결재 작성 가능" : "읽기 전용"}
                  </div>
                  <div style={{ marginTop: 12, color: "#475569" }}>{me?.userEmail}</div>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    background: "#f8fafc",
                    border: "1px solid #dbe4ec",
                    color: "#334155",
                    lineHeight: 1.7,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>정책 안내 열람 경로</div>
                  <div style={{ marginTop: 8 }}>{uiContract.helpText} 경로와 오류/차단 메시지 도움말에서 같은 기준으로 안내합니다.</div>
                </div>

                <button
                  onClick={() => {
                    clearUserToken();
                    setToken("");
                    setMe(null);
                  }}
                  style={{
                    height: 52,
                    borderRadius: 16,
                    border: 0,
                    background: "#0f172a",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  로그아웃
                </button>
              </article>
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>다국어 메시지 범위</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>오류 / 경고 / 차단 / 빈 상태까지 포함</h2>
                </div>
                <div style={{ color: "#64748b", fontSize: 14 }}>현재 언어 {locale}</div>
              </div>
              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
                {messageScopes.map((item) => (
                  <div key={item.title} style={{ borderRadius: 18, padding: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: item.tone, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.65 }}>{item.sample}</div>
                  </div>
                ))}
              </div>
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
                gap: 20,
                marginTop: 22,
              }}
            >
              <article
                style={{
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>알림 센터</div>
                    <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>업무 흐름과 연결된 알림</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshNotifications(token)}
                    disabled={loading}
                    style={{
                      height: 46,
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      padding: "0 16px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    알림 새로고침
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 18,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "#eef2ff",
                      color: "#3730a3",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    미읽음 {notificationSummary?.unreadCount ?? 0}
                  </span>
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "#fff7ed",
                      color: "#9a3412",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    긴급 {notificationSummary?.severityCount.CRITICAL ?? 0}
                  </span>
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    모드 {notificationMode === "streaming" ? "SSE" : notificationMode === "fallback" ? "Polling Fallback" : "Polling"}
                  </span>
                </div>

                {notificationError ? (
                  <div style={{ marginTop: 16, color: "#b91c1c", background: "#fff1f2", border: "1px solid #fecdd3", padding: "14px 16px", borderRadius: 16 }}>
                    {notificationError}
                  </div>
                ) : null}

                <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
                  {notifications.slice(0, 6).map((item) => (
                    <div
                      key={item.notificationId}
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 18,
                        borderRadius: 22,
                        background: item.status === "unread" ? "#f8fafc" : "#ffffff",
                        border: "1px solid #dbe4ec",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0f766e", fontWeight: 800 }}>
                            {item.category}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>{item.title}</div>
                        </div>
                        <span
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            background: item.status === "unread" ? "#fee2e2" : "#ecfccb",
                            color: item.status === "unread" ? "#991b1b" : "#3f6212",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.65 }}>{item.message}</div>
                      <div>
                        <button
                          type="button"
                          onClick={() => void executeAck(item.notificationId)}
                          disabled={loading || item.status !== "unread"}
                          style={{
                            height: 42,
                            borderRadius: 14,
                            border: "1px solid #cbd5e1",
                            background: item.status === "unread" ? "#fff" : "#f8fafc",
                            padding: "0 14px",
                            fontWeight: 700,
                            cursor: item.status === "unread" ? "pointer" : "default",
                          }}
                        >
                          읽음 처리
                        </button>
                      </div>
                    </div>
                  ))}
                  {notifications.length === 0 ? (
                    <div
                      style={{
                        padding: 20,
                        borderRadius: 22,
                        border: "1px dashed #cbd5e1",
                        color: "#64748b",
                        background: "#f8fafc",
                      }}
                    >
                      아직 표시할 알림이 없습니다.
                    </div>
                  ) : null}
                </div>
              </article>

              <article
                id="approval-compose"
                style={{
                  display: uiContract.quickComposeVisible ? "grid" : "none",
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>빠른 결재 작성</div>
                    <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>업무 중심 작성 화면</h2>
                  </div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>감사 로그 누적 {logsCount}</div>
                </div>

                {canAct.create ? (
                  <form onSubmit={handleCreate} style={{ display: "grid", gap: 14, marginTop: 20 }}>
                    <label style={{ display: "grid", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>제목</span>
                      <input
                        value={createForm.title}
                        onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
                        style={{
                          height: 48,
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          padding: "0 14px",
                          font: "inherit",
                        }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>내용</span>
                      <textarea
                        value={createForm.content}
                        onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))}
                        style={{
                          minHeight: 132,
                          borderRadius: 18,
                          border: "1px solid #cbd5e1",
                          padding: 14,
                          font: "inherit",
                          resize: "vertical",
                        }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>결재자 사용자 ID</span>
                      <input
                        value={createForm.approverUserIds}
                        onChange={(event) => setCreateForm((current) => ({ ...current, approverUserIds: event.target.value }))}
                        placeholder="user_123456,user_abcdef"
                        style={{
                          height: 48,
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          padding: "0 14px",
                          font: "inherit",
                        }}
                      />
                    </label>
                    <button
                      disabled={loading}
                      style={{
                        height: 52,
                        borderRadius: 16,
                        border: 0,
                        background: "linear-gradient(135deg, #0f766e 0%, #0f172a 100%)",
                        color: "#fff",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      결재 초안 저장
                    </button>
                  </form>
                ) : (
                  <div
                    style={{
                      marginTop: 20,
                      padding: 18,
                      borderRadius: 22,
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                      background: "#f8fafc",
                    }}
                  >
                    현재 계정은 결재 작성 권한이 없습니다.
                  </div>
                )}

                <div
                  style={{
                    marginTop: 22,
                    padding: 18,
                    borderRadius: 22,
                    background: "#f8fafc",
                    border: "1px solid #dbe4ec",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>보조 도구</div>
                  <div style={{ marginTop: 8, color: "#475569", lineHeight: 1.65 }}>
                    번역 기능은 핵심 업무를 막지 않는 보조 도구로 배치합니다. 메일, 결재, 메신저가 우선이고 번역은 하단 협업 도구 영역에서 제공합니다.
                  </div>
                  <form onSubmit={runTranslationDemo} style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    <textarea
                      value={translationSource}
                      onChange={(event) => setTranslationSource(event.target.value)}
                      placeholder="원문 입력"
                      style={{
                        minHeight: 90,
                        borderRadius: 16,
                        border: "1px solid #cbd5e1",
                        padding: 14,
                        font: "inherit",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <select
                        value={translationTargetLocale}
                        onChange={(event) => setTranslationTargetLocale(event.target.value)}
                        style={{ height: 44, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 12px", background: "#fff" }}
                      >
                        <option value="en">en</option>
                        <option value="ko">ko</option>
                        <option value="ja">ja</option>
                        <option value="zh-cn">zh-cn</option>
                        <option value="es">es</option>
                        <option value="fr">fr</option>
                        <option value="de">de</option>
                      </select>
                      <button
                        type="submit"
                        disabled={translationLoading}
                        style={{
                          height: 44,
                          borderRadius: 14,
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          padding: "0 14px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {translationLoading ? "변환 중..." : "번역"}
                      </button>
                      <span style={{ color: "#64748b", fontSize: 13 }}>Provider: {translationStatus?.provider || "unknown"}</span>
                    </div>
                    {translationError ? <div style={{ color: "#b91c1c" }}>{translationError}</div> : null}
                    {translationResult.length > 0 ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {translationResult.map((item) => (
                          <div key={`${item.sourceLocale}-${item.targetLocale}-${item.originalText}`} style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #dbe4ec" }}>
                            <div style={{ fontSize: 13, color: "#475569" }}>
                              {item.sourceLocale} → {item.targetLocale}
                            </div>
                            <div style={{ marginTop: 8, color: "#334155" }}>{item.originalText}</div>
                            <div style={{ marginTop: 8, color: "#0f766e", fontWeight: 700 }}>{item.translatedText}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </form>
                </div>
              </article>
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>업무 문서</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>결재 리스트와 상세 작업</h2>
                </div>
                <div style={{ color: "#64748b", fontSize: 14 }}>총 {documents.length}건</div>
              </div>

              <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
                {documents.map((doc) => {
                  const currentLine = doc.currentLineIndex == null ? null : doc.lines.find((item) => item.sequence === doc.currentLineIndex) ?? null;
                  return (
                    <article
                      key={doc.id}
                      style={{
                        borderRadius: 24,
                        padding: 20,
                        background: doc.status === "submitted" ? "#f8fafc" : "#fff",
                        border: "1px solid #dbe4ec",
                        display: "grid",
                        gap: 14,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{doc.status}</div>
                          <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>{doc.title}</div>
                        </div>
                        <div
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          작성자 {doc.creatorUserName}
                        </div>
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.65 }}>
                        현재 결재선: {currentLine ? `${currentLine.approverUserName} / ${currentLine.status}` : "대기 없음"}
                        {currentLine?.comment ? ` / ${currentLine.comment}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {doc.status === "draft" && canAct.submit && doc.creatorUserId === me?.userId && (
                          <button
                            onClick={() => void executeSubmit(doc.id, "submit")}
                            disabled={loading}
                            style={{ height: 42, borderRadius: 14, border: 0, padding: "0 14px", background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                          >
                            상신
                          </button>
                        )}
                        {doc.status === "submitted" && doc.creatorUserId === me?.userId && canAct.withdraw && (
                          <button
                            onClick={() => void executeSubmit(doc.id, "withdraw")}
                            disabled={loading}
                            style={{ height: 42, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", background: "#fff", fontWeight: 700, cursor: "pointer" }}
                          >
                            회수
                          </button>
                        )}
                        {doc.status === "rejected" && doc.creatorUserId === me?.userId && canAct.rework && (
                          <button
                            onClick={() => void executeSubmit(doc.id, "redraft")}
                            disabled={loading}
                            style={{ height: 42, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", background: "#fff", fontWeight: 700, cursor: "pointer" }}
                          >
                            재기안
                          </button>
                        )}
                        {doc.status === "submitted" && canAct.act && isCurrentApprover(doc) && (
                          <>
                            <input
                              value={doc.id === reasonAction.documentId ? reasonAction.reason : ""}
                              placeholder="처리 사유"
                              onChange={(event) => setReasonAction({ documentId: doc.id, reason: event.target.value })}
                              style={{ minWidth: 180, height: 42, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 12px", font: "inherit" }}
                            />
                            <button
                              onClick={() => {
                                void executeApprove(doc.id, true);
                              }}
                              disabled={loading}
                              style={{ height: 42, borderRadius: 14, border: 0, padding: "0 14px", background: "#14532d", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                            >
                              승인
                            </button>
                            <button
                              onClick={() => {
                                void executeApprove(doc.id, false);
                              }}
                              disabled={loading}
                              style={{ height: 42, borderRadius: 14, border: 0, padding: "0 14px", background: "#9f1239", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                            >
                              반려
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}

                {documents.length === 0 ? (
                  <div
                    style={{
                      padding: 20,
                      borderRadius: 22,
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                      background: "#f8fafc",
                    }}
                  >
                    아직 문서가 없습니다.
                  </div>
                ) : null}
              </div>
            </section>
          </section>
        </div>
      )}

      {message ? (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            maxWidth: 360,
            padding: "14px 16px",
            borderRadius: 18,
            background: "#0f766e",
            color: "#fff",
            boxShadow: "0 16px 32px rgba(15, 118, 110, 0.22)",
            fontWeight: 700,
          }}
        >
          {message}
        </div>
      ) : null}
    </main>
  );
}
