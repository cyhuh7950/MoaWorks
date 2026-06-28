import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  ackNotification,
  apiBase,
  approveApproval,
  clearUserToken,
  createApproval,
  fetchApprovalLogs,
  fetchApprovals,
  fetchMe,
  fetchNotifications,
  fetchNotificationSummary,
  fetchTranslationStatus,
  fetchUiContract,
  getUserToken,
  login,
  redraftApproval,
  rejectApproval,
  requestTranslation,
  storeUserToken,
  submitApproval,
  withdrawApproval,
  type ApprovalDocument,
  type AuthUser,
  type LoginResponse,
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
  homeCardOrder: ["alerts", "approval", "chat", "mail"],
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

type SurfaceCardProps = {
  title: string;
  value: string;
  subtext: string;
  tone: "teal" | "sand" | "ink" | "rose";
};

const toneMap: Record<SurfaceCardProps["tone"], { background: string; border: string; accent: string }> = {
  teal: { background: "linear-gradient(135deg, #0f766e, #115e59)", border: "#115e59", accent: "#99f6e4" },
  sand: { background: "linear-gradient(135deg, #9a6b2f, #7c4a10)", border: "#7c4a10", accent: "#fde68a" },
  ink: { background: "linear-gradient(135deg, #1f2937, #0f172a)", border: "#0f172a", accent: "#bfdbfe" },
  rose: { background: "linear-gradient(135deg, #9f1239, #7f1d1d)", border: "#7f1d1d", accent: "#fecdd3" },
};

function SurfaceCard({ title, value, subtext, tone }: SurfaceCardProps) {
  const currentTone = toneMap[tone];
  return (
    <article
      style={{
        background: currentTone.background,
        borderRadius: 24,
        padding: "22px 24px",
        color: "#f8fafc",
        border: `1px solid ${currentTone.border}`,
        boxShadow: "0 20px 40px rgba(15, 23, 42, 0.18)",
        minHeight: 172,
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
      subtext: "메일 메인함, 참조함, 개인 로컬 보관함을 같은 흐름에서 보이도록 설계합니다.",
      tone: "ink" as const,
    },
    {
      id: "approval",
      title: "대기 결재",
      value: `${dashboardStats.pendingApprovals}건`,
      subtext: "결재 상신, 승인, 반려, 회수까지 실제 업무 흐름을 메인 대시보드에서 즉시 진입합니다.",
      tone: "teal" as const,
    },
    {
      id: "chat",
      title: "최근 대화",
      value: "준비 중",
      subtext: "메신저 대화는 서버 2주 보관과 설치형 대화 파일 보관 흐름을 같은 계약으로 연결합니다.",
      tone: "sand" as const,
    },
    {
      id: "alerts",
      title: "오늘 알림",
      value: `${dashboardStats.unreadCount}건`,
      subtext: `긴급 ${dashboardStats.urgentCount}건 · SSE/폴링 폴백 유지 · 오늘 처리 대상 ${dashboardStats.todayApprovals}건`,
      tone: "rose" as const,
    },
  ].sort((left, right) => {
    const leftIndex = uiContract.homeCardOrder.indexOf(left.id);
    const rightIndex = uiContract.homeCardOrder.indexOf(right.id);
    const safeLeft = leftIndex === -1 ? 999 : leftIndex;
    const safeRight = rightIndex === -1 ? 999 : rightIndex;
    return safeLeft - safeRight;
  });

  const mailBuckets = [
    { title: "안 읽은 메일", count: `${notificationSummary?.unreadCount ?? 0}건`, note: "중요 메일과 읽지 않음 메일 우선 확인" },
    { title: "중요 메일", count: "12건", note: "별표, 참조, 마감 임박 메일 우선" },
    { title: "임시보관", count: "4건", note: "작성 중 메일과 예약 발송 초안" },
    { title: "로컬 아카이브", count: "설치형 연결", note: "장기 보관 메일은 설치형 아카이브로 이동" },
  ];

  const mailFolders = [
    { title: "받은편지함", count: "24", tone: "#0f766e" },
    { title: "중요 메일", count: "12", tone: "#b45309" },
    { title: "안 읽은 메일", count: `${notificationSummary?.unreadCount ?? 0}`, tone: "#1d4ed8" },
    { title: "임시보관함", count: "4", tone: "#7c3aed" },
    { title: "보낸편지함", count: "18", tone: "#334155" },
    { title: "참조 / 공유 메일", count: "7", tone: "#9f1239" },
    { title: "설치형 로컬 아카이브", count: "연결", tone: "#14532d" },
  ];

  const mailListSamples = [
    { sender: "대표이사", subject: "3분기 계약 검토 요청", preview: "첨부한 계약서 수정 의견을 오늘 안으로 회신해 주세요.", time: "09:14", unread: true, important: true, attachment: true },
    { sender: "경영지원팀", subject: "복지 포인트 정산 안내", preview: "이번 달 마감일과 제출 서류를 다시 안내드립니다.", time: "08:42", unread: true, important: false, attachment: false },
    { sender: "제품 디자인 TF", subject: "시안 리뷰 일정 변경", preview: "오늘 15시 리뷰를 16시로 조정했습니다. 회의 링크 포함.", time: "어제", unread: false, important: true, attachment: true },
    { sender: "대외협력팀", subject: "행사 참석 여부 확인", preview: "참석자 명단 확정을 위해 금일 회신 부탁드립니다.", time: "어제", unread: false, important: false, attachment: false },
  ];

  const mailStatusMessages = [
    { title: "빈 상태", body: "현재 조건에 맞는 메일이 없습니다.", tone: "#475569" },
    { title: "오류 상태", body: uiContract.messages.error, tone: "#b91c1c" },
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
    { title: "최근 대화", note: "최근 24시간 기준 대화와 읽지 않음 메시지 우선" },
    { title: "즐겨찾기 채널", note: "팀 공지, 프로젝트룸, 임원 보고룸 고정" },
    { title: "첨부 / 링크", note: "파일, 링크, 회의록을 대화와 같은 흐름에서 확인" },
    { title: "로컬 파일 보관", note: "상세 보관은 설치형 클라이언트의 대화 파일 흐름으로 연결" },
  ];

  const messengerRooms = [
    { title: "최근 대화", entries: ["제품 디자인 TF", "경영지원 공지방", "릴리즈 대응 채널"] },
    { title: "고정 대화방", entries: ["대표 보고룸", "운영 장애 대응", "영업 협업방"] },
    { title: "부서 채널", entries: ["개발본부", "경영지원", "대외협력"] },
    { title: "프로젝트 채널", entries: ["MoaWorks v1.3", "고객사 온보딩", "모바일 개선 TF"] },
    { title: "1:1 대화", entries: ["김팀장", "박과장", "최디자이너"] },
  ];

  const messengerTimeline = [
    { sender: "김팀장", time: "09:22", body: "오늘 승인 대기 문서 우선 처리 부탁드립니다.", meta: "읽음 3 · 링크 1" },
    { sender: "박과장", time: "09:25", body: "계약 검토 메일 첨부본을 채널에 다시 올렸습니다.", meta: "첨부 1 · 파일 2" },
    { sender: "최디자이너", time: "09:31", body: "시안 피드백은 고정 메시지에 정리해 두었습니다.", meta: "고정 메시지 갱신" },
  ];

  const collaborationPanels = [
    { title: "참여자 목록", body: "김팀장, 박과장, 최디자이너, 신사업 TF 외 12명" },
    { title: "공유 파일", body: "시안_v3.fig, 계약검토.pdf, 회의록_0624.docx" },
    { title: "고정 메시지", body: "오늘 16시 리뷰, 회수 금지 문서, 대외 공유 금지" },
    { title: "최근 링크", body: "회의 링크, Figma, 운영 점검표, 승인 현황 보드" },
  ];

  const messageScopes = [
    { title: "빈 상태", sample: uiContract.messages.empty, tone: "#475569" },
    { title: "오류 메시지", sample: notificationError || approvalError || uiContract.messages.error, tone: "#b91c1c" },
    { title: "차단 메시지", sample: uiContract.messages.blocked, tone: "#9f1239" },
    { title: "경고 메시지", sample: uiContract.messages.warning, tone: "#9a3412" },
    { title: "성공 메시지", sample: message || uiContract.messages.success, tone: "#166534" },
  ];

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
                <article key={item.title} style={{ borderRadius: 18, padding: 16, border: "1px solid #dbe4ec", background: "#fff" }}>
                  <strong>{item.title}</strong>
                  <div style={{ marginTop: 8, color: item.tone, fontWeight: 800 }}>{item.count}</div>
                </article>
              ))}
            </aside>
            <section style={{ display: "grid", gap: 10, alignContent: "start", overflowY: "auto" }}>
              {mailListSamples.map((item) => (
                <article key={`${item.sender}-${item.subject}`} style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: item.unread ? "#f8fafc" : "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{item.sender}</strong>
                    <span style={{ color: "#64748b", fontSize: 13 }}>{item.time}</span>
                  </div>
                  <h3 style={{ margin: "8px 0 6px", fontSize: 18 }}>{item.subject}</h3>
                  <p style={{ margin: 0, color: "#475569", lineHeight: 1.55 }}>{item.preview}</p>
                </article>
              ))}
            </section>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 상세</div>
              <h2 style={{ margin: "10px 0 0", fontSize: 28 }}>3분기 계약 검토 요청</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>오늘 안으로 계약 조항 변경 포인트를 검토해 주세요. 회신, 전달, 중요 표시, 보관 이동을 이 패널에서 처리합니다.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {["답장", "전달", "중요 표시", "보관 이동"].map((action) => (
                  <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>{action}</span>
                ))}
              </div>
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
              {messengerRooms.map((group) => (
                <article key={group.title} style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: "#fff" }}>
                  <strong>{group.title}</strong>
                  {group.entries.map((entry) => <p key={entry} style={{ margin: "8px 0 0", color: "#475569" }}>{entry}</p>)}
                </article>
              ))}
            </aside>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>대화 타임라인</div>
              <h2 style={{ margin: "10px 0 0", fontSize: 28 }}>최근 대화</h2>
              {messengerTimeline.map((item) => (
                <div key={`${item.sender}-${item.time}`} style={{ marginTop: 12, padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                  <strong>{item.sender}</strong>
                  <span style={{ marginLeft: 10, color: "#64748b", fontSize: 13 }}>{item.time}</span>
                  <p style={{ color: "#334155", lineHeight: 1.6 }}>{item.body}</p>
                  <div style={{ color: "#0f766e", fontSize: 13, fontWeight: 700 }}>{item.meta}</div>
                </div>
              ))}
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
              <SurfaceCard key={item.id} title={item.title} value={item.value} subtext={item.subtext} tone={item.tone} />
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
                  <button key={item.title} type="button" onClick={() => setActivePortalMenu(item.key)} style={{ textAlign: "left", borderRadius: 20, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 18, color: "#0f172a", cursor: "pointer" }}>
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
                <button type="button" onClick={() => setActivePortalMenu("alerts")} style={{ height: 42, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 14px", fontWeight: 800 }}>알림 열기</button>
              </article>
              <button onClick={() => { clearUserToken(); setToken(""); setMe(null); }} style={{ height: 48, borderRadius: 16, border: 0, background: "#0f172a", color: "#fff", fontWeight: 800 }}>로그아웃</button>
            </aside>
          </section>
        </section>
      );
    };

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
                <button key={item.key} type="button" onClick={() => setActivePortalMenu(item.key)} style={{ borderRadius: 16, padding: "12px 14px", border: activePortalMenu === item.key ? "1px solid #7dd3fc" : "1px solid rgba(255,255,255,0.05)", background: activePortalMenu === item.key ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.04)", color: "#e2e8f0", textAlign: "left", cursor: "pointer" }}>
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
                {uiContract.quickComposeVisible ? <button type="button" onClick={() => setActivePortalMenu("approval")} style={{ height: 46, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 16px", fontWeight: 800 }}>빠른 작성</button> : null}
                <button type="button" onClick={refreshUiContract} style={{ height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px", fontWeight: 700 }}>설정 반영</button>
              </div>
            </header>
            <section style={{ minHeight: 0, overflow: "hidden" }}>{renderWorkPanel()}</section>
          </section>
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
              <p style={{ margin: 0, maxWidth: 660, color: "rgba(248,250,252,0.82)", fontSize: 18, lineHeight: 1.7 }}>
                단순 API 테스트 화면이 아니라 실제 업무 사용자를 위한 그룹웨어 메인 화면을 기준으로 다시 설계합니다.
                메일과 메신저 보관 정책은 Help와 정책 안내, 설정 화면에서 확인하도록 분리하고 메인 화면은 업무 처리 동선에 집중합니다.
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
                <div
                  style={{
                    display: "inline-flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "#f0fdfa",
                    border: "1px solid #99f6e4",
                    fontSize: 13,
                    color: "#115e59",
                  }}
                >
                  API Base
                  <strong>{apiBase}</strong>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 14,
                  marginTop: 24,
                }}
              >
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>언어</span>
                  <select
                    value={locale}
                    onChange={(event) => saveLocale(event.target.value as AppLocale)}
                    style={{
                      height: 48,
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      padding: "0 14px",
                      background: "#fff",
                      font: "inherit",
                    }}
                  >
                    {supportedLocales.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>시간대</span>
                  <select
                    value={timezone}
                    onChange={(event) => saveTimezone(event.target.value)}
                    style={{
                      height: 48,
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      padding: "0 14px",
                      background: "#fff",
                      font: "inherit",
                    }}
                  >
                    {supportedTimezones.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
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
                정책 상세 본문은 메인 화면에 직접 노출하지 않습니다. 확인 경로는 `Help`, `정책 안내`, `설정 &gt; 보관 정책`으로 고정합니다.
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
            <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.7 }}>
              메일, 결재, 메신저, 일정, 파일과 알림을 한 번에 다루는 그룹웨어 메인 화면 시안입니다.
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
                {uiContract.quickComposeVisible ? (
                  <button
                    type="button"
                    onClick={() => {
                      document.getElementById("approval-compose")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
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
                <SurfaceCard key={item.id} title={item.title} value={item.value} subtext={item.subtext} tone={item.tone} />
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
                      <div style={{ marginTop: 8, color: "#475569" }}>초안, 상신, 승인대기, 반려, 완료 상태를 탭 구조로 구분하고 상태 배지 대비를 높여 가독성을 보정합니다.</div>
                    </div>
                    <div style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                      <strong>최근 결재 활동</strong>
                      <div style={{ marginTop: 8, color: "#475569" }}>감사 로그 누적 {logsCount}건, 승인/반려/회수 최근 기록을 사용자 화면에서도 요약 노출합니다.</div>
                    </div>
                  </div>
                  <div style={{ borderRadius: 22, padding: 20, background: "#fff", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>결재 상세 보기</div>
                    <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>문서 리스트와 상세 작업을 한 흐름으로</h3>
                    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                      <div style={{ padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        상태 탭, 상세 본문, 결재선, 최근 활동, 빠른 작성 버튼을 같은 화면에 두어 테스트용 테이블 느낌을 줄이고 정보 밀도를 메일/메신저 수준으로 맞춥니다.
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
                      서버 보관과 로컬 파일 보관은 기능 설명 본문이 아니라 설치형 대화 파일 저장 흐름으로 이어지는 진입 구조만 표시합니다.
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
                  <div style={{ fontSize: 13, color: "#64748b" }}>언어 {locale} · 시간대 {timezone}</div>
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
