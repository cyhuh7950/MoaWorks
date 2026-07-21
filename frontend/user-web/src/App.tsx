import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  ackNotification,
  bulkMailAction,
  readAllNotifications,
  apiBase,
  approveApproval,
  changePassword,
  ApiRequestError,
  clearUserToken,
  createApproval,
  fetchApprovalApprovers,
  fetchContacts,
  fetchApprovalLogs,
  fetchApprovals,
  fetchDraftMail,
  fetchInbox,
  fetchMailDeliveryStatus,
  fetchMailDetail,
  fetchMailStorage,
  fetchMe,
  fetchMessengerMessages,
  fetchMessengerRoom,
  fetchMessengerRooms,
  fetchSchedules,
  fetchNotifications,
  fetchNotificationSummary,
  fetchSentMail,
  fetchWorkspaceDirectory,
  fetchWorkspaceFiles,
  fetchWorkspaceNotice,
  fetchWorkspaceNotices,
  fetchTranslationStatus,
  fetchUiContract,
  getUserToken,
  login,
  markMailRead,
  readMessengerRoom,
  readWorkspaceNotice,
  redraftApproval,
  rejectApproval,
  requestTranslation,
  saveMailDraft,
  sendMail,
  sendMessengerMessage,
  storeUserToken,
  submitApproval,
  toggleMailStar,
  setMailCategory,
  updateApproval,
  withdrawApproval,
  type ApprovalApprover,
  type ApprovalDocument,
  type AuditLog,
  type AuthUser,
  type LoginResponse,
  type MailDeliveryStatusResponse,
  type MailDetail,
  type MailListQuery,
  type MailStorageResponse,
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
  type WorkspaceNotice,
  type WorkspaceSchedule,
} from "./api";
import { resolveLocale, supportedLocales, supportedTimezones, type AppLocale } from "./i18n";
import { MessengerPanel } from "./MessengerPanel";
import { WorkspacePanels } from "./WorkspacePanels";
import { SplitView } from "./SplitView";
import { NotificationCenter } from "./NotificationCenter";
import { UserHome } from "./UserHome";
import { CompactWarning, ConfirmModal, FeedbackState, ToastViewport, useFeedbackQueue } from "./components/FeedbackSystem";

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

const MAIL_CATEGORIES = [
  ["primary", "기본"],
  ["promotions", "프로모션"],
  ["social", "소셜"],
  ["updates", "업데이트"],
  ["forums", "포럼"],
] as const;

const DEFAULT_MAIL_LIST_QUERY: MailListQuery = {
  q: "",
  read: "all",
  starred: "all",
  attachment: "all",
  category: "primary",
  sort: "date_desc",
  limit: 50,
  offset: 0,
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
  company: {
    name: string;
    domain: string;
    logoDataUrl: string;
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
  company: {
    name: "MoaWorks",
    domain: "moaworks.local",
    logoDataUrl: "",
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

function buildCompanyInitials(name: string): string {
  const cleaned = name.replace(/[^0-9A-Za-z가-힣]/g, "").trim();
  if (!cleaned) return "MW";
  return Array.from(cleaned).slice(0, 2).join("").toUpperCase();
}

function buildDefaultCompanyLogo(name: string, primary: string, secondary: string): string {
  const initials = buildCompanyInitials(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192" role="img" aria-label="${name} logo">
      <defs>
        <linearGradient id="portalLogoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="44" fill="url(#portalLogoBg)" />
      <circle cx="148" cy="48" r="20" fill="rgba(255,255,255,0.14)" />
      <text x="96" y="108" text-anchor="middle" font-family="Segoe UI, Noto Sans KR, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${initials}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function mergeUiContract(raw: Partial<UiContract> | null | undefined): UiContract {
  const brand = {
    ...defaultUiContract.brand,
    ...(raw?.brand ?? {}),
  };
  const company = {
    ...defaultUiContract.company,
    ...(raw?.company ?? {}),
  };
  return {
    brand,
    company: {
      name: company.name?.trim() || defaultUiContract.company.name,
      domain: company.domain?.trim() || defaultUiContract.company.domain,
      logoDataUrl: company.logoDataUrl?.trim() || buildDefaultCompanyLogo(company.name || defaultUiContract.company.name, brand.primary, brand.secondary),
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
  loginId: string;
  password: string;
};

type CreateForm = {
  title: string;
  content: string;
  approverUserIds: string[];
};

type ApprovalModalMode = "none" | "create" | "edit" | "submit" | "approve" | "reject" | "withdraw" | "redraft";

type PasswordChangeForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type MailComposeForm = {
  to: string;
  subject: string;
  bodyText: string;
};

type ReasonAction = {
  documentId: string;
  reason: string;
};

type WorkspaceTab = "mail" | "approval" | "messenger";
type UserPortalMenu = "home" | "mail" | "approval" | "messenger" | "schedule" | "contacts" | "org" | "files" | "alerts" | "notices" | "settings" | "help";
type MailboxType = "inbox" | "sent";
type MailFolderType = MailboxType | "starred" | "unread" | "draft" | "localArchive";
type QuickComposeMode = "none" | "mail" | "approval" | "messenger";
type UnifiedSearchType = "mail" | "approval" | "messenger" | "schedule" | "contacts" | "org" | "files";
type UnifiedSearchResult = { id: string; type: UnifiedSearchType; title: string; detail: string; menu: UserPortalMenu; mailbox?: MailboxType };

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

function normalizeLoginIdInput(value: string): string {
  return value.trim().toLowerCase();
}

function buildCompanyLoginEmail(loginId: string, companyDomain: string): string {
  return `${normalizeLoginIdInput(loginId)}@${companyDomain.trim().toLowerCase()}`;
}

function normalizeMailRecipients(value: string, companyDomain: string): string[] {
  const domain = companyDomain.trim().toLowerCase();
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.includes("@") ? item : `${item}@${domain}`));
}

function hasExternalRecipients(recipients: string[], companyDomain: string): boolean {
  const suffix = `@${companyDomain.trim().toLowerCase()}`;
  return recipients.some((item) => !item.endsWith(suffix));
}

export default function App() {
  const [token, setToken] = useState("");
  const [locale, setLocale] = useState<AppLocale>(resolveLocale(window.localStorage.getItem("moaworks.locale")));
  const [timezone, setTimezone] = useState(window.localStorage.getItem("moaworks.timezone") || "Asia/Seoul");
  const [uiContract, setUiContract] = useState<UiContract>(() => defaultUiContract);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState<"all" | UnifiedSearchType>("all");
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchWorkspaceSelection, setSearchWorkspaceSelection] = useState<{ menu: "schedule" | "contacts" | "org" | "files"; id: string } | null>(null);
  const [loginForm, setLoginForm] = useState<LoginForm>({ loginId: "", password: "" });
  const [passwordChangeForm, setPasswordChangeForm] = useState<PasswordChangeForm>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [createForm, setCreateForm] = useState<CreateForm>({
    title: "",
    content: "",
    approverUserIds: [],
  });
  const [approvalModal, setApprovalModal] = useState<ApprovalModalMode>("none");
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("all");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [approverSearch, setApproverSearch] = useState("");
  const [approvalApprovers, setApprovalApprovers] = useState<ApprovalApprover[]>([]);
  const [approvalLogs, setApprovalLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [documents, setDocuments] = useState<ApprovalDocument[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<NotificationSummary | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [homeSchedules, setHomeSchedules] = useState<WorkspaceSchedule[]>([]);
  const [homeNotices, setHomeNotices] = useState<WorkspaceNotice[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<WorkspaceNotice | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState("");
  const [homeScheduleSelectionId, setHomeScheduleSelectionId] = useState("");
  const [reasonAction, setReasonAction] = useState<ReasonAction>({ documentId: "", reason: "" });
  const { items: feedbackItems, push: pushFeedback, dismiss: dismissFeedback, clearTransient: clearTransientFeedback } = useFeedbackQueue();
  const [mailDeleteConfirmOpen, setMailDeleteConfirmOpen] = useState(false);
  const [mailComposeCloseConfirmOpen, setMailComposeCloseConfirmOpen] = useState(false);
  const [mailBulkBusy, setMailBulkBusy] = useState(false);
  function setMessage(nextMessage: string) {
    if (!nextMessage) {
      clearTransientFeedback();
      return;
    }
    pushFeedback({
      id: `app:${activePortalMenu}:${nextMessage}`,
      source: activePortalMenu,
      tone: "success",
      title: nextMessage,
    });
  }
  const [translationStatus, setTranslationStatus] = useState<{ provider: string; enabled: boolean; available: boolean } | null>(null);
  const [translationSource, setTranslationSource] = useState("");
  const [translationTargetLocale, setTranslationTargetLocale] = useState("en");
  const [translationResult, setTranslationResult] = useState<TranslationItem[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [me, setMe] = useState<AuthUser | null>(null);
  const [logsCount, setLogsCount] = useState(0);
  const [notificationMode, setNotificationMode] = useState<"polling" | "streaming" | "fallback">("polling");
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
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
  const [draftMails, setDraftMails] = useState<MailSummary[]>([]);
  const [selectedMailId, setSelectedMailId] = useState("");
  const [selectedMailIds, setSelectedMailIds] = useState<string[]>([]);
  const [mailListQuery, setMailListQuery] = useState<MailListQuery>(DEFAULT_MAIL_LIST_QUERY);
  const [mailSearchDraft, setMailSearchDraft] = useState("");
  const [mailListMeta, setMailListMeta] = useState({ total: 0, limit: 50, offset: 0, hasMore: false });
  const [mailMoveCategory, setMailMoveCategory] = useState("primary");
  const [mailBulkReloadError, setMailBulkReloadError] = useState("");
  const [composeWindow, setComposeWindow] = useState<"normal" | "minimized" | "maximized">("normal");
  const [mailComposeContext, setMailComposeContext] = useState<"new" | "reply" | "forward">("new");
  const [mailComposePosition, setMailComposePosition] = useState<{ left: number; top: number } | null>(null);
  const [mailDetailExpanded, setMailDetailExpanded] = useState(false);
  const [selectedMailDetail, setSelectedMailDetail] = useState<MailDetail | null>(null);
  const [mailDeliveryStatus, setMailDeliveryStatus] = useState<MailDeliveryStatusResponse | null>(null);
  const [mailComposeForm, setMailComposeForm] = useState<MailComposeForm>({ to: "", subject: "", bodyText: "" });
  const [mailError, setMailError] = useState("");
  const [mailLoading, setMailLoading] = useState(false);
  const [mailCategoryBusy, setMailCategoryBusy] = useState(false);
  const [mailStorage, setMailStorage] = useState<MailStorageResponse | null>(null);
  const [mailStorageLoading, setMailStorageLoading] = useState(false);
  const [mailStorageError, setMailStorageError] = useState("");
  const [messengerRoomsData, setMessengerRoomsData] = useState<MessengerRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedRoomDetail, setSelectedRoomDetail] = useState<MessengerRoomDetail | null>(null);
  const [roomMessages, setRoomMessages] = useState<MessengerMessage[]>([]);
  const [messengerDraft, setMessengerDraft] = useState("");
  const [messengerError, setMessengerError] = useState("");
  const [messengerLoading, setMessengerLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const streamCursorRef = useRef<string>("");
  const streamRetryRef = useRef(0);

  async function loadNotificationData(targetToken: string): Promise<void> {
    setNotificationLoading(true);
    try {
      const summary = await fetchNotificationSummary(targetToken);
      const response = await fetchNotifications(targetToken, { limit: 20, unreadOnly: false });
      setNotificationSummary(summary);
      setNotifications([...(response.notifications ?? [])].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()));
    } finally {
      setNotificationLoading(false);
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
      setMailError("");
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
    setShowNotificationPanel(false);
    clearTransientFeedback();
    setApprovalError("");
    setMailError("");
    setMessengerError("");
    setSearchError("");
    setActivePortalMenu(nextMenu);
  }

  function setMailFolder(folder: MailFolderType) {
    setActiveMailFolder(folder);
    setSelectedMailIds([]);
    setSelectedMailId("");
    setSelectedMailDetail(null);
    setMailBulkReloadError("");
    setMailListQuery((current) => ({ ...current, offset: 0 }));
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

  function openMailFolder(folder: MailFolderType) {
    setMailFolder(folder);
    if (!token || folder === "localArchive") return;
    const nextQuery = { ...mailListQuery, offset: 0 };
    void loadMailWorkspace(token, folder === "sent" ? "sent" : "inbox", undefined, folder, nextQuery);
  }

  function getMailListByFolder(folder: MailFolderType) {
    if (folder === "sent") {
      return sentMails;
    }
    if (folder === "starred") {
      return inboxMails;
    }
    if (folder === "unread") {
      return inboxMails;
    }
    if (folder === "draft") {
      return draftMails;
    }
    if (folder === "localArchive") {
      return [];
    }
    return inboxMails;
  }

  function openNewMailCompose() {
    setMailComposeContext("new");
    setMailComposePosition(null);
    setComposeWindow("normal");
    setMailComposeForm({ to: "", subject: "", bodyText: "" });
    setMailError("");
    setQuickComposeMode("mail");
  }

  function startMailComposeDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (composeWindow !== "normal") return;
    const popup = event.currentTarget.closest("form");
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: MouseEvent) => {
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      setMailComposePosition({ left: Math.min(Math.max(8, moveEvent.clientX - offsetX), maxLeft), top: Math.min(Math.max(8, moveEvent.clientY - offsetY), maxTop) });
    };
    const stop = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop, { once: true });
  }

  function inferMailboxFromMailId(mailId: string): MailboxType {
    if (inboxMails.some((item) => item.mailId === mailId)) return "inbox";
    if (draftMails.some((item) => item.mailId === mailId)) return "sent";
    return "sent";
  }

  function updateMailListQuery(patch: Partial<MailListQuery>) {
    const nextQuery = { ...mailListQuery, ...patch, offset: patch.offset ?? 0 };
    setMailListQuery(nextQuery);
    setSelectedMailIds([]);
    setMailBulkReloadError("");
    if (token) {
      void loadMailWorkspace(token, activeMailFolder === "sent" ? "sent" : "inbox", undefined, activeMailFolder, nextQuery);
    }
  }

  async function runBulkMailAction(action: "read" | "unread" | "star" | "unstar" | "move" | "delete", targetCategory?: string): Promise<boolean> {
    if (!token || selectedMailIds.length === 0 || mailBulkBusy) return false;
    setMailBulkBusy(true);
    setMailError("");
    setMailBulkReloadError("");
    try {
      const mailbox = activeMailFolder === "sent" ? "sent" : activeMailFolder === "draft" ? "draft" : "inbox";
      const result = await bulkMailAction(token, selectedMailIds, action, mailbox, targetCategory);
      setMessage(`${result.changedCount}개 변경 · ${result.unchangedCount}개 유지`);
      setSelectedMailIds([]);
      const reloaded = await loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery);
      if (!reloaded) {
        setMailBulkReloadError("저장은 완료됐지만 목록을 다시 불러오지 못했습니다. 새로고침해 주세요.");
      }
      return true;
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "메일 일괄 처리에 실패했습니다.");
      return false;
    } finally {
      setMailBulkBusy(false);
    }
  }

  async function changeSelectedMailCategory(category: string) {
    if (!token || !selectedMailId || !["inbox", "starred", "unread"].includes(activeMailFolder) || mailCategoryBusy) return;
    if ((selectedMailSummary?.category || "primary") === category) return;
    setMailCategoryBusy(true);
    setMailError("");
    try {
      await setMailCategory(token, selectedMailId, category);
      const nextQuery = { ...mailListQuery, category: category as MailListQuery["category"], offset: 0 };
      setMailListQuery(nextQuery);
      try {
        const response = await fetchInbox(token, nextQuery);
        setInboxMails(response.mails ?? []);
        setMailListMeta({ total: response.total, limit: response.limit, offset: response.offset, hasMore: response.hasMore });
      } catch {
        setMailError("저장은 완료됐지만 목록을 다시 불러오지 못했습니다.");
        return;
      }
      setMessage("메일 분류를 변경했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "메일 분류 변경에 실패했습니다."));
    } finally {
      setMailCategoryBusy(false);
    }
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

  async function refreshMailDeliveryState(targetToken = token) {
    if (!targetToken) {
      setMailDeliveryStatus(null);
      return;
    }
    try {
      const status = await fetchMailDeliveryStatus(targetToken);
      setMailDeliveryStatus(status);
    } catch {
      setMailDeliveryStatus(null);
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
      const next = existed
        ? current.map((item) => (item.notificationId === notification.notificationId ? notification : item))
        : [notification, ...current];
      return next.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
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

  async function selectMail(targetToken: string, mailId: string, mailbox: MailboxType, options?: { markRead?: boolean; propagateError?: boolean }) {
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
      if (options?.propagateError) throw error;
    } finally {
      setMailLoading(false);
    }
  }

  async function loadMailWorkspace(
    targetToken: string,
    preferredMailbox?: MailboxType,
    preferredMailId?: string,
    preferredFolder: MailFolderType = activeMailFolder,
    query: MailListQuery = mailListQuery,
  ): Promise<boolean> {
    setMailLoading(true);
    setMailError("");
    try {
      const effectiveQuery: MailListQuery = {
        ...query,
        read: preferredFolder === "unread" ? "unread" : query.read,
        starred: preferredFolder === "starred" ? "starred" : query.starred,
        category: preferredFolder === "inbox" ? query.category : "all",
      };
      const defaultQuery: MailListQuery = { ...DEFAULT_MAIL_LIST_QUERY, category: "all" };
      const inboxQuery = ["inbox", "starred", "unread"].includes(preferredFolder) ? effectiveQuery : defaultQuery;
      const sentQuery = preferredFolder === "sent" ? effectiveQuery : defaultQuery;
      const draftQuery = preferredFolder === "draft" ? effectiveQuery : defaultQuery;
      const [inboxResponse, sentResponse, draftResponse] = await Promise.all([
        fetchInbox(targetToken, inboxQuery),
        fetchSentMail(targetToken, sentQuery),
        fetchDraftMail(targetToken, draftQuery),
      ]);
      const nextInbox = inboxResponse.mails ?? [];
      const nextSent = sentResponse.mails ?? [];
      const nextDrafts = draftResponse.mails ?? [];
      setInboxMails(nextInbox);
      setSentMails(nextSent);
      setDraftMails(nextDrafts);
      const activeResponse = preferredFolder === "sent" ? sentResponse : preferredFolder === "draft" ? draftResponse : inboxResponse;
      setMailListMeta({
        total: activeResponse.total,
        limit: activeResponse.limit,
        offset: activeResponse.offset,
        hasMore: activeResponse.hasMore,
      });
      const mailbox = preferredMailbox ?? activeMailbox;
      const activeList = preferredFolder === "sent" ? nextSent : preferredFolder === "draft" ? nextDrafts : nextInbox;
      const resolvedMailbox = preferredFolder === "sent" ? "sent" : mailbox;
      const resolvedMailId = preferredMailId ?? selectedMailId;
      const targetMail = resolvedMailId
        ? activeList.find((item) => item.mailId === resolvedMailId) ?? null
        : activeList[0] ?? null;
      setActiveMailbox(resolvedMailbox);
      if (targetMail) {
        const detail = await fetchMailDetail(targetToken, targetMail.mailId);
        setSelectedMailId(targetMail.mailId);
        setSelectedMailDetail(detail);
      } else {
        setSelectedMailId("");
        setSelectedMailDetail(null);
      }
      return true;
    } catch (error) {
      setMailError(normalizeClientError(error, "메일 목록 조회 실패"));
      setInboxMails([]);
      setSentMails([]);
      setDraftMails([]);
      setMailListMeta({ total: 0, limit: query.limit ?? 50, offset: query.offset ?? 0, hasMore: false });
      setSelectedMailId("");
      setSelectedMailDetail(null);
      return false;
    } finally {
      setMailLoading(false);
    }
  }

  async function loadMailStorage(targetToken: string) {
    setMailStorageLoading(true);
    setMailStorageError("");
    try {
      setMailStorage(await fetchMailStorage(targetToken));
    } catch (error) {
      setMailStorageError(normalizeClientError(error, "메일 용량을 불러오지 못했습니다."));
    } finally {
      setMailStorageLoading(false);
    }
  }

  function openMailQuickSearch() {
    setSearchFilter("mail");
    setSearchOpen(Boolean(searchText.trim()));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function formatStorageBytes(value: number) {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
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
      setDraftMails((current) =>
        current.map((item) => (item.mailId === selectedMailId ? { ...item, isStarred: Boolean(response.isStarred) } : item)),
      );
      setSelectedMailDetail((current) => (current ? { ...current } : current));
      await selectMail(token, selectedMailId, activeMailbox, { markRead: false });
      setMessage(response.isStarred ? "메일을 중요 표시했습니다." : "메일 중요 표시를 해제했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "중요 표시 변경 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  async function handleSelectedMailReadAction() {
    if (!token || !selectedMailId) return;
    setMailLoading(true);
    setMailError("");
    try {
      const mailbox = inferMailboxFromMailId(selectedMailId);
      const shouldMarkRead = mailbox === "inbox" && !selectedMailSummary?.isRead;
      if (shouldMarkRead) {
        await markMailRead(token, selectedMailId);
        setInboxMails((current) => current.map((item) => (item.mailId === selectedMailId ? { ...item, isRead: true } : item)));
      }
      const detail = await fetchMailDetail(token, selectedMailId);
      setSelectedMailDetail(detail);
      setMessage(shouldMarkRead ? "메일을 읽음 처리했습니다." : "메일 읽음 상태를 확인했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "읽음 상태 확인 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  async function submitMailCompose(action: "draft" | "send") {
    if (!token) return;
    const recipients = normalizeMailRecipients(mailComposeForm.to, uiContract.company.domain);
    const subject = mailComposeForm.subject.trim();
    const bodyText = mailComposeForm.bodyText.trim();
    if (!recipients.length) {
      setMailError("받는 사람을 입력해 주세요.");
      return;
    }
    if (!subject) {
      setMailError("제목을 입력해 주세요.");
      return;
    }
    if (!bodyText) {
      setMailError("본문을 입력해 주세요.");
      return;
    }
    const hasExternal = hasExternalRecipients(recipients, uiContract.company.domain);
    if (hasExternal && !mailDeliveryStatus?.provider.enabled) {
      setMailError("자체 SMTP 엔진이 비활성화되어 외부 수신자에게 발송할 수 없습니다.");
      return;
    }
    if (hasExternal && !mailDeliveryStatus) {
      setMailError("외부 발송 상태를 아직 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setMailLoading(true);
    setMailError("");
    try {
      const payload = { to: recipients, subject, bodyText };
      const response = action === "draft" ? await saveMailDraft(token, payload) : await sendMail(token, payload);
      if (action === "draft") {
        setMessage("메일을 임시저장했습니다.");
      } else if (response.deliverySummary?.externalRecipientCount) {
        setMessage(
          `메일을 발송했습니다. 외부 ${response.deliverySummary.externalRecipientCount}건 / sent ${response.deliverySummary.sentCount} / retry ${response.deliverySummary.retryPendingCount} / failed ${response.deliverySummary.failedCount}`,
        );
      } else {
        setMessage("메일을 발송했습니다.");
      }
      setMailComposeForm({ to: "", subject: "", bodyText: "" });
      setQuickComposeMode("none");
      const nextMailbox: MailboxType = action === "draft" ? "inbox" : "sent";
      setMailFolder(action === "draft" ? "draft" : "sent");
      await refreshMailDeliveryState(token);
      await loadMailWorkspace(
        token,
        nextMailbox,
        response.mailId,
        action === "draft" ? "draft" : "sent",
        { ...mailListQuery, offset: 0 },
      );
    } catch (error) {
      setMailError(normalizeClientError(error, action === "draft" ? "메일 임시저장 실패" : "메일 발송 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  function openMailComposeFromDetail(mode: "reply" | "forward") {
    if (!selectedMailDetail) return;
    const subjectPrefix = mode === "reply" ? "Re: " : "Fwd: ";
    const subject = selectedMailDetail.subject.startsWith(subjectPrefix)
      ? selectedMailDetail.subject
      : `${subjectPrefix}${selectedMailDetail.subject}`;
    const quoted = [
      "",
      "--- 원문 ---",
      `발신자: ${selectedMailDetail.senderEmail}`,
      `수신자: ${selectedMailDetail.recipients.map((item) => item.recipientEmail).join(", ")}`,
      `제목: ${selectedMailDetail.subject}`,
      selectedMailDetail.bodyText,
    ].join("\n");
    setMailComposeForm({
      to: mode === "reply" ? selectedMailDetail.senderEmail : "",
      subject,
      bodyText: quoted,
    });
    setMailComposeContext(mode);
    setMailComposePosition(null);
    setComposeWindow("normal");
    setQuickComposeMode("mail");
  }

  function resetMailCompose() {
    setMailComposeForm({ to: "", subject: "", bodyText: "" });
    setMailComposeContext("new");
    setMailComposePosition(null);
    setComposeWindow("normal");
    setQuickComposeMode("none");
    setMailComposeCloseConfirmOpen(false);
  }

  function closeMailCompose() {
    const hasDraft = Boolean(mailComposeForm.to || mailComposeForm.subject || mailComposeForm.bodyText);
    if (hasDraft) {
      setMailComposeCloseConfirmOpen(true);
      return;
    }
    resetMailCompose();
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
      setHomeSchedules([]);
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

  async function loadHomeSchedules(targetToken: string) {
    const response = await fetchSchedules(targetToken);
    setHomeSchedules(response.items ?? []);
  }

  async function loadHomeNotices(targetToken: string) {
    const response = await fetchWorkspaceNotices(targetToken);
    setHomeNotices(response.items ?? []);
  }

  async function openHomeItem(target: "mail" | "approval" | "schedule" | "messenger" | "notices", itemId: string) {
    if (target === "mail") {
      setPortalMenu("mail");
      await selectMail(token, itemId, "inbox", { markRead: true });
      return;
    }
    if (target === "approval") {
      setPortalMenu("approval");
      await selectApprovalDocument(itemId);
      return;
    }
    if (target === "schedule") {
      setHomeScheduleSelectionId(itemId);
      setPortalMenu("schedule");
      return;
    }
    if (target === "messenger") {
      setPortalMenu("messenger");
      await selectMessengerRoom(token, itemId, { markRead: true });
      return;
    }
    setPortalMenu("notices");
    const detail = await fetchWorkspaceNotice(token, itemId);
    setSelectedNotice(detail);
    if (!detail.is_read) {
      const read = await readWorkspaceNotice(token, itemId);
      setSelectedNotice(read);
      await loadHomeNotices(token);
    }
  }

  function closeUnifiedSearch() {
    setSearchText("");
    setSearchOpen(false);
    setSearchFilter("all");
    setSearchResults([]);
    setSearchError("");
  }

  function openSearchResult(result: UnifiedSearchResult) {
    if (result.type === "mail") {
      void selectMail(token, result.id, result.mailbox ?? "inbox", { markRead: false });
    } else if (result.type === "approval") {
      void selectApprovalDocument(result.id);
    } else if (result.type === "messenger") {
      void selectMessengerRoom(token, result.id, { markRead: false });
    } else {
      setSearchWorkspaceSelection({ menu: result.menu as "schedule" | "contacts" | "org" | "files", id: result.id });
      if (result.type === "schedule") setHomeScheduleSelectionId(result.id);
    }
    setPortalMenu(result.menu);
    closeUnifiedSearch();
  }

  useEffect(() => {
    const query = searchText.trim().toLowerCase();
    if (!token || !me || me.mustChangePassword || !query) {
      setSearchOpen(false);
      setSearchResults([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchOpen(true);
      setSearchLoading(true);
      setSearchError("");

      void Promise.all([fetchSchedules(token), fetchContacts(token), fetchWorkspaceDirectory(token), fetchWorkspaceFiles(token)])
        .then(([schedules, contacts, directory, files]) => {
          if (cancelled) return;
          const includes = (value: string) => value.toLowerCase().includes(query);
          const rows: UnifiedSearchResult[] = [
            ...[
              ...inboxMails.map((item) => ({ item, mailbox: "inbox" as const })),
              ...sentMails.map((item) => ({ item, mailbox: "sent" as const })),
              ...draftMails.map((item) => ({ item, mailbox: "inbox" as const })),
            ].filter(({ item }) => includes(`${item.subject} ${item.senderEmail} ${item.accountId}`)).slice(0, 5).map(({ item, mailbox }) => ({ id: item.mailId, type: "mail" as const, title: item.subject || "(제목 없음)", detail: item.senderEmail, menu: "mail" as const, mailbox })),
            ...documents.filter((item) => includes(`${item.title} ${item.creatorUserName} ${item.status}`)).slice(0, 5).map((item) => ({ id: item.id, type: "approval" as const, title: item.title, detail: item.status, menu: "approval" as const })),
            ...messengerRoomsData.filter((item) => includes(`${item.roomName} ${item.lastMessage ?? ""}`)).slice(0, 5).map((item) => ({ id: item.roomId, type: "messenger" as const, title: item.roomName, detail: item.lastMessage ?? "최근 메시지 없음", menu: "messenger" as const })),
            ...(schedules.items ?? []).filter((item) => includes(`${item.title} ${item.description}`)).slice(0, 5).map((item) => ({ id: item.id, type: "schedule" as const, title: item.title, detail: formatDateLabel(item.starts_at), menu: "schedule" as const })),
            ...(contacts.items ?? []).filter((item) => includes(`${item.name} ${item.email} ${item.company_name}`)).slice(0, 5).map((item) => ({ id: item.id, type: "contacts" as const, title: item.name, detail: item.email || item.company_name, menu: "contacts" as const })),
            ...[
              ...directory.departments.filter((item) => includes(`${item.name} ${item.department_code ?? ""}`)).map((item) => ({ id: item.id, type: "org" as const, title: item.name, detail: "부서", menu: "org" as const })),
              ...directory.users.filter((item) => includes(`${item.name} ${item.email} ${item.department_name}`)).map((item) => ({ id: item.id, type: "org" as const, title: item.name, detail: item.department_name || item.role_name, menu: "org" as const })),
            ].slice(0, 5),
            ...(files.items ?? []).filter((item) => includes(`${item.file_name} ${item.content_type}`)).slice(0, 5).map((item) => ({ id: item.id, type: "files" as const, title: item.file_name, detail: item.content_type || "파일", menu: "files" as const })),
          ];
          setSearchResults(rows);
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchResults([]);
            setSearchError(normalizeClientError(error, "통합 검색 결과를 불러오지 못했습니다."));
          }
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText, token, me?.userId, me?.mustChangePassword, inboxMails, sentMails, draftMails, documents, messengerRoomsData]);

  useEffect(() => {
    const current = getUserToken();
    if (current) {
      setToken(current);
    }
    void loadTranslationState();
    void refreshUiContract().catch(() => setUiContract(defaultUiContract));
  }, []);

  useEffect(() => {
    if (!token || !me || me.mustChangePassword) {
      stopNotificationStream();
      return;
    }
    void reload().catch((error) => setApprovalError(error instanceof Error ? error.message : "조회 실패"));
    void loadMailWorkspace(token).catch((error) => setMailError(normalizeClientError(error, "메일 조회 실패")));
    void loadMailStorage(token);
    void loadMessengerWorkspace(token).catch((error) => setMessengerError(normalizeClientError(error, "메신저 조회 실패")));
    setHomeLoading(true);
    setHomeError("");
    void Promise.all([loadHomeSchedules(token), loadHomeNotices(token)])
      .catch((error) => setHomeError(normalizeClientError(error, "홈 업무 현황 조회 실패")))
      .finally(() => setHomeLoading(false));
    void loadTranslationState().catch(() => undefined);
    void refreshMailDeliveryState(token).catch(() => undefined);
    connectNotificationStream(token);
    return () => {
      stopNotificationStream();
    };
  }, [token, me?.mustChangePassword, me?.userId]);

  useEffect(() => {
    if (!token) {
      setMe(null);
      setTranslationStatus(null);
      setTranslationResult([]);
      setTranslationError("");
      setInboxMails([]);
      setSentMails([]);
      setDraftMails([]);
      setSelectedMailId("");
      setSelectedMailDetail(null);
      setMailDeliveryStatus(null);
      setMailComposeForm({ to: "", subject: "", bodyText: "" });
      setQuickComposeMode("none");
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
      if (loginForm.loginId.includes("@")) {
        setApprovalError("아이디만 입력하세요. 회사 도메인은 자동으로 적용됩니다.");
        return;
      }
      const response = (await login({
        email: buildCompanyLoginEmail(loginForm.loginId, uiContract.company.domain),
        password: loginForm.password,
      })) as LoginResponse;
      storeUserToken(response.accessToken);
      setToken(response.accessToken);
      setMe(response.user);
      if (response.user.mustChangePassword) {
        setPasswordChangeForm({
          currentPassword: loginForm.password,
          newPassword: "",
          confirmPassword: "",
        });
        setMessage("최초 로그인입니다. 비밀번호를 변경한 뒤 업무 화면으로 이동합니다.");
        return;
      }
      setMessage(`${response.user.userName}님, 업무 포털에 접속했습니다.`);
      await loadTranslationState();
      await refreshMailDeliveryState(response.accessToken);
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  }

  async function handleForcedPasswordChange(event: FormEvent) {
    event.preventDefault();
    if (!token || !me) return;
    if (passwordChangeForm.newPassword !== passwordChangeForm.confirmPassword) {
      setApprovalError("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    setApprovalError("");
    try {
      const response = await changePassword(token, {
        currentPassword: passwordChangeForm.currentPassword,
        newPassword: passwordChangeForm.newPassword,
      });
      setMe(response.user);
      setLoginForm({ loginId: loginForm.loginId, password: passwordChangeForm.newPassword });
      setPasswordChangeForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage("비밀번호 변경이 완료되어 업무 화면으로 이동합니다.");
      await loadTranslationState();
      await refreshMailDeliveryState(token);
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "비밀번호 변경 실패");
    } finally {
      setLoading(false);
    }
  }

  async function selectApprovalDocument(documentId: string) {
    setSelectedApprovalId(documentId);
    if (!token) return;
    try {
      const response = await fetchApprovalLogs(token, documentId);
      setApprovalLogs(response.logs);
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재 이력 조회 실패"));
      setApprovalLogs([]);
    }
  }

  async function openApprovalEditor(mode: "create" | "edit", document?: ApprovalDocument) {
    if (!token) return;
    setApprovalError("");
    try {
      const response = await fetchApprovalApprovers(token);
      setApprovalApprovers(response.users);
      setApproverSearch("");
      setCreateForm(
        document
          ? { title: document.title, content: document.content, approverUserIds: document.lines.map((line) => line.approverUserId) }
          : { title: "", content: "", approverUserIds: [] },
      );
      if (document) {
        setSelectedApprovalId(document.id);
      }
      setApprovalModal(mode);
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재선 사용자 조회 실패"));
    }
  }

  function closeApprovalModal() {
    if ((approvalModal === "create" || approvalModal === "edit") && (createForm.title || createForm.content || createForm.approverUserIds.length)) {
      if (!window.confirm("작성 중인 내용이 있습니다. 닫으시겠습니까?")) return;
    }
    setApprovalModal("none");
    setReasonAction({ documentId: "", reason: "" });
  }

  function selectApprovalApprover(userId: string) {
    setCreateForm((current) => current.approverUserIds.includes(userId) ? current : { ...current, approverUserIds: [...current.approverUserIds, userId] });
  }

  function moveApprovalApprover(userId: string, direction: -1 | 1) {
    setCreateForm((current) => {
      const index = current.approverUserIds.indexOf(userId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.approverUserIds.length) return current;
      const approverUserIds = [...current.approverUserIds];
      [approverUserIds[index], approverUserIds[nextIndex]] = [approverUserIds[nextIndex], approverUserIds[index]];
      return { ...current, approverUserIds };
    });
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!createForm.approverUserIds.length) {
      setApprovalError("상신 전 결재선을 최소 1명 이상 선택하세요.");
      return;
    }
    setLoading(true);
    setApprovalError("");
    try {
      const isEdit = approvalModal === "edit";
      const documentId = selectedApprovalId;
      if (isEdit && documentId) {
        await updateApproval(token, documentId, createForm);
        setMessage("결재 초안이 수정되었습니다.");
      } else {
        const response = await createApproval(token, createForm);
        setSelectedApprovalId(response.documentId);
        setMessage("결재 초안이 저장되었습니다.");
      }
      setApprovalModal("none");
      setCreateForm({ title: "", content: "", approverUserIds: [] });
      await reload();
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재 초안 저장 실패"));
    } finally {
      setLoading(false);
    }
  }

  async function executeApprove(documentId: string, accepted: boolean) {
    if (!token) return;
    if (!accepted && !reasonAction.reason.trim()) {
      setApprovalError("반려 의견을 입력하세요.");
      return;
    }
    setLoading(true);
    setApprovalError("");
    try {
      const act = accepted ? approveApproval : rejectApproval;
      await act(token, documentId, reasonAction.reason.trim() || "확인");
      setReasonAction({ documentId: "", reason: "" });
      setApprovalModal("none");
      await reload();
      await selectApprovalDocument(documentId);
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재 처리 실패"));
    } finally {
      setLoading(false);
    }
  }

  async function executeSubmit(documentId: string, action: "submit" | "withdraw" | "redraft") {
    if (!token) return;
    setLoading(true);
    setApprovalError("");
    try {
      if (action === "submit") await submitApproval(token, documentId);
      else if (action === "withdraw") await withdrawApproval(token, documentId);
      else await redraftApproval(token, documentId);
      setApprovalModal("none");
      await reload();
      await selectApprovalDocument(documentId);
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재 상태 변경 실패"));
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

  async function executeReadAll() {
    if (!token) return;
    setLoading(true);
    setNotificationError("");
    try {
      await readAllNotifications(token);
      await refreshNotifications(token);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "전체 읽음 처리 실패");
    } finally {
      setLoading(false);
    }
  }

  function closeNotificationPanel() {
    setShowNotificationPanel(false);
    requestAnimationFrame(() => notificationButtonRef.current?.focus());
  }

  function toggleNotificationPanel() {
    if (showNotificationPanel) {
      closeNotificationPanel();
      return;
    }
    setShowNotificationPanel(true);
  }

  async function openNotificationTarget(menu: "mail" | "approval" | "messenger" | "schedule" | "files" | "notices" | "alerts", item: NotificationRecord) {
    if (!token) return;
    if (item.status === "unread") {
      await executeAck(item.notificationId);
    }
    closeNotificationPanel();
    setPortalMenu(menu);
    try {
      if (menu === "mail") {
        await selectMail(token, item.resourceId, "inbox", { markRead: true, propagateError: true });
      } else if (menu === "approval") {
        await selectApprovalDocument(item.resourceId);
      } else if (menu === "messenger") {
        await selectMessengerRoom(token, item.resourceId, { markRead: true });
      } else if (menu === "schedule") {
        setSearchWorkspaceSelection({ menu: "schedule", id: item.resourceId });
      } else if (menu === "files") {
        setSearchWorkspaceSelection({ menu: "files", id: item.resourceId });
      } else if (menu === "notices") {
        const detail = await fetchWorkspaceNotice(token, item.resourceId);
        setSelectedNotice(detail);
      }
    } catch {
      const originError = "원본 항목이 삭제되었거나 접근 권한이 없습니다.";
      if (menu === "mail") setMailError(originError);
      else if (menu === "approval") setApprovalError(originError);
      else if (menu === "messenger") setMessengerError(originError);
      else setNotificationError(originError);
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
    { label: "메일", desc: "받은편지함 우선 확인" },
    { label: "결재", desc: `${dashboardStats.pendingApprovals}건 대기` },
    { label: "메신저", desc: "최근 대화 확인" },
    { label: "일정", desc: "오늘 일정" },
    { label: "주소록", desc: "조직도·연락처 연계" },
    { label: "조직도", desc: "부서 및 권한 구조" },
    { label: "파일", desc: "업무 파일 허브" },
    { label: "설정", desc: "언어, 시간대, 화면" },
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
  const allPageSelected = visibleMailList.length > 0 && visibleMailList.every((item) => selectedMailIds.includes(item.mailId));
  const inboxBulkEnabled = activeMailFolder === "inbox" || activeMailFolder === "starred" || activeMailFolder === "unread";
  const localMailArchiveHint = activeMailFolder === "localArchive" ? "로컬 아카이브에서 확인" : "";
  const starredMailCount = [...inboxMails, ...sentMails].filter((item) => item.isStarred).length;
  const draftMailCount = draftMails.length;
  const unreadInboxCount = inboxMails.filter((item) => !item.isRead).length;
  const selectedMailSummary =
    visibleMailList.find((item) => item.mailId === selectedMailId) ??
    inboxMails.find((item) => item.mailId === selectedMailId) ??
    sentMails.find((item) => item.mailId === selectedMailId) ??
    draftMails.find((item) => item.mailId === selectedMailId) ??
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
        : item.previewText || item.subject,
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
      title: "협업 안내",
      body: "정책 경로: Help / 정책",
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
    { title: "성공 메시지", sample: feedbackItems[feedbackItems.length - 1]?.title || uiContract.messages.success, tone: "#166534" },
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

  if (token && !me) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
        }}
      >
        <section style={{ width: "min(480px, calc(100% - 40px))", background: "#fff", borderRadius: 28, padding: 28, border: "1px solid #dbe4ec", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)" }}>
          <h2 style={{ marginTop: 0 }}>세션 확인 중</h2>
          <p style={{ marginBottom: 0, color: "#475569" }}>저장된 사용자 세션을 확인하고 있습니다.</p>
        </section>
      </main>
    );
  }

  if (token && me?.mustChangePassword) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
          padding: 24,
        }}
      >
        <section style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: 32, padding: 30, border: "1px solid #dbe4ec", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)", display: "grid", gap: 18 }}>
          <div>
            <div style={{ display: "inline-flex", padding: "8px 14px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>First Login Policy</div>
            <h1 style={{ margin: "18px 0 10px", fontSize: 34, lineHeight: 1.15, letterSpacing: "-0.04em" }}>최초 로그인 비밀번호 변경</h1>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>초기 비밀번호는 아이디와 동일하게 설정되었습니다. 업무 화면에 진입하기 전에 새 비밀번호로 변경해야 합니다.</p>
          </div>
          <article style={{ padding: 18, borderRadius: 22, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
            <strong>{me.userName}</strong>
            <div style={{ marginTop: 6, color: "#475569" }}>{me.userEmail}</div>
            <div style={{ marginTop: 6, color: "#475569" }}>권한 역할: {me.roleName}</div>
          </article>
          <form onSubmit={handleForcedPasswordChange} style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>현재 비밀번호</span>
              <input type="password" value={passwordChangeForm.currentPassword} onChange={(event) => setPasswordChangeForm((current) => ({ ...current, currentPassword: event.target.value }))} style={{ height: 48, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", font: "inherit" }} />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>새 비밀번호</span>
              <input type="password" value={passwordChangeForm.newPassword} onChange={(event) => setPasswordChangeForm((current) => ({ ...current, newPassword: event.target.value }))} style={{ height: 48, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", font: "inherit" }} />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>새 비밀번호 확인</span>
              <input type="password" value={passwordChangeForm.confirmPassword} onChange={(event) => setPasswordChangeForm((current) => ({ ...current, confirmPassword: event.target.value }))} style={{ height: 48, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", font: "inherit" }} />
            </label>
            {approvalError ? <FeedbackState state="error" title="비밀번호를 변경하지 못했습니다." message={approvalError} /> : null}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" disabled={loading} style={{ height: 50, borderRadius: 16, border: 0, background: "linear-gradient(135deg, #0f766e 0%, #0f172a 100%)", color: "#fff", padding: "0 18px", fontWeight: 800, cursor: "pointer" }}>
                {loading ? "변경 중..." : "비밀번호 변경 후 계속"}
              </button>
              <button type="button" onClick={() => { clearUserToken(); setToken(""); setMe(null); setPasswordChangeForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); }} style={{ height: 50, borderRadius: 16, border: "1px solid #cbd5e1", background: "#fff", padding: "0 18px", fontWeight: 700, cursor: "pointer" }}>로그아웃</button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (token && me) {
    const portalMenus: Array<{ key: UserPortalMenu; label: string; desc: string }> = [
      { key: "home", label: "홈", desc: "오늘 업무 우선순위" },
      { key: "mail", label: "메일", desc: `${notificationSummary?.unreadCount ?? 0}건 확인` },
      { key: "approval", label: "결재", desc: `${dashboardStats.pendingApprovals}건 대기` },
      { key: "messenger", label: "메신저", desc: "최근 대화" },
      { key: "schedule", label: "일정", desc: "오늘 일정" },
      { key: "contacts", label: "주소록", desc: "연락처" },
      { key: "org", label: "조직도", desc: "부서/역할" },
      { key: "files", label: "파일", desc: "업무 파일" },
      { key: "settings", label: "설정", desc: "언어/화면" },
      { key: "help", label: "Help / 정책", desc: "정책 경로" },
    ];

    const renderWorkPanel = () => {
      if (["messenger"].includes(activePortalMenu as string)) {
        return <MessengerPanel token={token} />;
      }
      if (["schedule", "contacts", "org", "files", "settings", "help"].includes(activePortalMenu)) {
        return (
          <WorkspacePanels
            menu={activePortalMenu as "schedule" | "contacts" | "org" | "files" | "settings" | "help"}
            token={token}
            locale={locale}
            timezone={timezone}
            initialSelectionId={searchWorkspaceSelection?.menu === activePortalMenu ? searchWorkspaceSelection.id : activePortalMenu === "schedule" ? homeScheduleSelectionId : undefined}
            onPreferencesSaved={(nextLocale, nextTimezone) => {
              saveLocale(resolveLocale(nextLocale));
              saveTimezone(nextTimezone);
            }}
          />
        );
      }
      if (activePortalMenu === "notices") {
        const currentNotice = selectedNotice ?? homeNotices[0] ?? null;
        return <section className="ui008-notice-workspace" aria-label="공지 목록과 상세">
          <article className="ui008-notice-list">
            <header><h2>공지</h2><span>{homeNotices.filter((item) => !item.is_read).length}건 미확인</span></header>
            <div>{homeNotices.map((item) => <button key={item.id} type="button" className={currentNotice?.id === item.id ? "is-active" : ""} onClick={() => void openHomeItem("notices", item.id)}><strong>{item.title}</strong><span>{item.author_name} · {formatDateLabel(item.published_at)}</span></button>)}</div>
            {!homeNotices.length ? <FeedbackState state="empty" title="게시된 공지가 없습니다." /> : null}
          </article>
          <article className="ui008-notice-detail">
            {currentNotice ? <><header><span>{currentNotice.is_read ? "읽음" : "미확인"}</span><h2>{currentNotice.title}</h2><p>{currentNotice.author_name} · {formatDateLabel(currentNotice.published_at)}</p></header><div>{currentNotice.content}</div></> : <FeedbackState state="empty" title="공지 선택" message="목록에서 공지를 선택하세요." />}
          </article>
        </section>;
      }
      if (activePortalMenu === "mail") {
        return (
          <section className={`user-mail-workbench${mailDetailExpanded ? " is-detail-expanded" : ""}`}>
            <aside className="user-mail-shell" aria-label="메일함 메뉴">
              <button type="button" className="user-mail-compose-action" onClick={openNewMailCompose}>메일쓰기</button>
              <div className="user-mail-shell-group" aria-label="즐겨찾기">
                <strong>즐겨찾기</strong>
                <button type="button" aria-pressed={activeMailFolder === "starred"} onClick={() => openMailFolder("starred")}>중요 <span>{starredMailCount}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "unread"} onClick={() => openMailFolder("unread")}>안 읽은 메일 <span>{unreadInboxCount}</span></button>
              </div>
              <div className="user-mail-shell-group" aria-label="기본 메일함">
                <strong>메일함</strong>
                <button type="button" aria-pressed={activeMailFolder === "inbox"} onClick={() => openMailFolder("inbox")}>받은편지함 <span>{inboxMails.length}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "sent"} onClick={() => openMailFolder("sent")}>보낸편지함 <span>{sentMails.length}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "draft"} onClick={() => openMailFolder("draft")}>임시보관함 <span>{draftMailCount}</span></button>
                {[
                  ["예약메일함", "예약 발송은 UI-018에서 제공합니다."],
                  ["스팸메일함", "스팸 메일함은 UI-020에서 제공합니다."],
                  ["휴지통", "휴지통 관리는 UI-020에서 제공합니다."],
                  ["사용자 메일함", "사용자 메일함 관리는 UI-020에서 제공합니다."],
                  ["태그", "태그 관리는 UI-020에서 제공합니다."],
                ].map(([label, tooltip]) => (
                  <button key={label} type="button" aria-disabled="true" data-tooltip={tooltip} onClick={(event) => event.preventDefault()}>{label} <span aria-hidden="true">i</span></button>
                ))}
              </div>
              <div className="user-mail-shell-group" aria-label="메일 도구">
                <strong>도구</strong>
                <button type="button" onClick={openMailQuickSearch}>빠른 검색</button>
                <button type="button" onClick={() => setPortalMenu("settings")}>환경설정</button>
              </div>
              <div className="user-mail-storage" aria-live="polite">
                <div><strong>메일 용량</strong>{mailStorage ? <span>{Math.round(mailStorage.usagePercent)}%</span> : null}</div>
                <progress max="100" value={Math.min(100, mailStorage?.usagePercent ?? 0)} />
                {mailStorageLoading ? <small>용량 확인 중</small> : null}
                {!mailStorageLoading && mailStorage && mailStorage.quotaBytes > 0 ? <small>{formatStorageBytes(mailStorage.usedBytes)} / {formatStorageBytes(mailStorage.quotaBytes)}</small> : null}
                {!mailStorageLoading && mailStorage && mailStorage.quotaBytes === 0 ? <small>할당량 미설정 · 사용량 {formatStorageBytes(mailStorage.usedBytes)}</small> : null}
                {!mailStorageLoading && mailStorageError ? <><small role="alert">{mailStorageError}</small><button type="button" onClick={() => void loadMailStorage(token)}>용량 다시 시도</button></> : null}
              </div>
            </aside>
            <SplitView
              ariaLabel="메일 목록과 상세 영역 너비 조절"
              storageKey="moaworks.user.mail.split-ratio.v1"
              secondaryMaximized={mailDetailExpanded}
              primary={(
            <section className="user-mail-list-panel">
              {activeMailFolder !== "localArchive" ? (
                <form className="user-mail-toolbar" onSubmit={(event) => { event.preventDefault(); updateMailListQuery({ q: mailSearchDraft }); }}>
                  <input aria-label="메일 검색" maxLength={200} value={mailSearchDraft} onChange={(event) => setMailSearchDraft(event.target.value)} placeholder="제목·보낸 사람·본문 검색" />
                  <button type="submit" disabled={mailLoading}>검색</button>
                  <select aria-label="읽음 필터" title={activeMailFolder === "unread" ? "안 읽은 메일함의 고정 조건" : "읽음 상태 필터"} disabled={activeMailFolder === "unread"} value={activeMailFolder === "unread" ? "unread" : mailListQuery.read} onChange={(event) => updateMailListQuery({ read: event.target.value as MailListQuery["read"] })}><option value="all">전체 읽음</option><option value="read">읽음</option><option value="unread">안 읽음</option></select>
                  <select aria-label="중요 필터" title={activeMailFolder === "starred" ? "중요 메일함의 고정 조건" : "중요 상태 필터"} disabled={activeMailFolder === "starred"} value={activeMailFolder === "starred" ? "starred" : mailListQuery.starred} onChange={(event) => updateMailListQuery({ starred: event.target.value as MailListQuery["starred"] })}><option value="all">전체 중요</option><option value="starred">중요</option><option value="unstarred">일반</option></select>
                  <select aria-label="첨부 필터" value={mailListQuery.attachment} onChange={(event) => updateMailListQuery({ attachment: event.target.value as MailListQuery["attachment"] })}><option value="all">전체 첨부</option><option value="with">첨부 있음</option><option value="without">첨부 없음</option></select>
                  {activeMailFolder === "inbox" ? <select aria-label="분류 필터" value={mailListQuery.category} onChange={(event) => updateMailListQuery({ category: event.target.value as MailListQuery["category"] })}><option value="all">전체 분류</option>{MAIL_CATEGORIES.map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select> : null}
                  <select aria-label="정렬" value={mailListQuery.sort} onChange={(event) => updateMailListQuery({ sort: event.target.value as MailListQuery["sort"] })}><option value="date_desc">최신순</option><option value="date_asc">오래된순</option><option value="sender_asc">보낸 사람순</option><option value="subject_asc">제목순</option></select>
                  <button type="button" title="현재 조건으로 다시 조회" onClick={() => void loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery)}>새로고침</button>
                  <label title="현재 결과 페이지의 메일만 선택"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allPageSelected} onChange={(event) => setSelectedMailIds(event.target.checked ? visibleMailList.map((item) => item.mailId) : [])} />전체</label>
                  <span aria-live="polite">선택 {selectedMailIds.length} / 전체 {mailListMeta.total}</span>
                  {inboxBulkEnabled ? <><button type="button" title="선택 메일 읽음" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("read")}>읽음</button><button type="button" title="선택 메일 안 읽음" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("unread")}>안 읽음</button><button type="button" title="선택 메일 중요" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("star")}>중요</button><button type="button" title="선택 메일 중요 해제" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("unstar")}>중요 해제</button><select aria-label="분류 이동 대상" value={mailMoveCategory} onChange={(event) => setMailMoveCategory(event.target.value)}>{MAIL_CATEGORIES.map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select><button type="button" title="선택 메일 분류 이동" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("move", mailMoveCategory)}>분류 이동</button></> : null}
                  <button type="button" title="선택 메일 삭제" onClick={() => setMailDeleteConfirmOpen(true)} disabled={!selectedMailIds.length || mailBulkBusy}>삭제</button>
                  <button type="button" title="이전 페이지" disabled={mailListMeta.offset === 0 || mailLoading} onClick={() => updateMailListQuery({ offset: Math.max(0, mailListMeta.offset - mailListMeta.limit) })}>이전</button>
                  <button type="button" title="다음 페이지" disabled={!mailListMeta.hasMore || mailLoading} onClick={() => updateMailListQuery({ offset: mailListMeta.offset + mailListMeta.limit })}>다음</button>
                  {inboxBulkEnabled && selectedMailId && selectedMailSummary && inboxMails.some((item) => item.mailId === selectedMailId) ? <select aria-label="선택 메일 분류" value={selectedMailSummary.category || "primary"} disabled={mailCategoryBusy} onChange={(event) => void changeSelectedMailCategory(event.target.value)}>{MAIL_CATEGORIES.map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select> : null}
                  {mailBulkBusy || mailCategoryBusy ? <small aria-live="polite">메일 저장 중</small> : null}
                </form>
              ) : null}
              {mailBulkReloadError ? <div className="user-mail-reload-error" role="alert"><span>{mailBulkReloadError}</span><button type="button" onClick={() => void loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery)}>목록 다시 불러오기</button></div> : null}
              {activeMailFolder === "localArchive" ? (
                <article style={{ borderRadius: 20, padding: 18, border: "1px solid #dbe4ec", background: "#fff", color: "#334155", lineHeight: 1.7 }}>
                  {mailLoading
                    ? "로컬 아카이브를 동기화하고 있습니다."
                    : "로컬 아카이브는 설치형에서 확인합니다."}
                </article>
              ) : (
                <>
                  {mailListSamples.map((item) => (
                    <article
                      key={item.mailId}
                      className="user-mail-row"
                      data-selected={selectedMailId === item.mailId}
                      data-unread={item.unread}
                    >
                      <input type="checkbox" aria-label={`메일 선택: ${item.subject}`} checked={selectedMailIds.includes(item.mailId)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedMailIds((current) => event.target.checked ? [...current, item.mailId] : current.filter((mailId) => mailId !== item.mailId))} />
                      <button className="user-mail-row__main" type="button" onClick={() => { setMailDetailExpanded(false); const mailbox = inferMailboxFromMailId(item.mailId); void selectMail(token, item.mailId, mailbox, { markRead: mailbox === "inbox" }); }}>
                        <div><strong>{item.sender}</strong><span>{item.time}</span></div>
                        <div><span>{item.important ? "★" : ""}{item.attachment ? " 첨부" : ""}</span><strong>{item.subject}</strong></div>
                        <p>{item.preview}</p>
                      </button>
                    </article>
                  ))}
                  {mailListSamples.length === 0 && !selectedMailId ? (
                    <FeedbackState
                      state={mailLoading ? "loading" : mailError ? "error" : "empty"}
                      title={mailLoading ? "메일을 불러오는 중입니다." : mailError ? "메일을 불러오지 못했습니다." : "표시할 메일이 없습니다."}
                      message={mailError || undefined}
                      action={mailError ? { label: "다시 시도", onAction: () => void loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery) } : undefined}
                    />
                  ) : null}
                </>
              )}
            </section>
              )}
              secondary={(
            <article className="user-mail-detail-panel">
              {quickComposeMode === "mail" ? (
                <form className={`user-mail-compose-popup is-${composeWindow}`} onSubmit={(event) => event.preventDefault()} style={{ display: "grid", gap: 12, position: "fixed", zIndex: 30, right: mailComposePosition ? "auto" : 24, bottom: mailComposePosition ? "auto" : 24, left: mailComposePosition?.left, top: mailComposePosition?.top, width: composeWindow === "maximized" ? "min(900px, calc(100vw - 280px))" : "min(520px, calc(100vw - 48px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto", resize: composeWindow === "normal" ? "both" : "none", borderRadius: 18, border: "1px solid #cbd5e1", background: "#fff", padding: 18, boxShadow: "0 18px 50px rgba(15, 23, 42, .24)" }}>
                  <div className="user-mail-compose-titlebar" onMouseDown={startMailComposeDrag} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 작성</div>
                      <h2 style={{ margin: "10px 0 0", fontSize: 22 }}>{mailComposeContext === "reply" ? "답장" : mailComposeContext === "forward" ? "전달" : "새 메일"}</h2>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}><button type="button" onClick={() => setComposeWindow((current) => current === "minimized" ? "normal" : "minimized")} style={{ height: 34 }}>최소화</button><button type="button" onClick={() => setComposeWindow((current) => current === "maximized" ? "normal" : "maximized")} style={{ height: 34 }}>확대</button><button type="button" onClick={closeMailCompose} style={{ height: 34 }}>닫기</button></div>
                  </div>
                  <div className="user-mail-compose-body">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 800, color: "#334155" }}>받는 사람</span>
                    <input
                      aria-label="mail-compose-to"
                      value={mailComposeForm.to}
                      onChange={(event) => setMailComposeForm((current) => ({ ...current, to: event.target.value }))}
                      placeholder={`admin@${uiContract.company.domain}`}
                      style={{ height: 38, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px", font: "inherit" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 800, color: "#334155" }}>제목</span>
                    <input
                      aria-label="mail-compose-subject"
                      value={mailComposeForm.subject}
                      onChange={(event) => setMailComposeForm((current) => ({ ...current, subject: event.target.value }))}
                      placeholder="제목 입력"
                      style={{ height: 38, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 12px", font: "inherit" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, minHeight: 0 }}>
                    <span style={{ fontWeight: 800, color: "#334155" }}>본문</span>
                    <textarea
                      aria-label="mail-compose-body"
                      value={mailComposeForm.bodyText}
                      onChange={(event) => setMailComposeForm((current) => ({ ...current, bodyText: event.target.value }))}
                      placeholder="본문 입력"
                      style={{ minHeight: 180, resize: "vertical", borderRadius: 12, border: "1px solid #cbd5e1", padding: 12, font: "inherit", lineHeight: 1.5 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" disabled={mailLoading} onClick={() => void submitMailCompose("draft")} style={{ height: 38, borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", padding: "0 14px", fontWeight: 800, cursor: "pointer" }}>임시저장</button>
                    <button type="button" disabled={mailLoading} onClick={() => void submitMailCompose("send")} style={{ height: 38, borderRadius: 12, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 14px", fontWeight: 800, cursor: "pointer" }}>발송</button>
                  </div>
                  {mailError ? <FeedbackState state="error" title="메일을 처리하지 못했습니다." message={mailError} /> : null}
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 상세</div>
                      <h2 style={{ margin: "10px 0 0", fontSize: 22 }}>{selectedMailDetail?.subject || "메일을 선택하세요"}</h2>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}><button type="button" aria-label={mailDetailExpanded ? "메일 상세 분할 보기" : "메일 상세 전체 보기"} aria-pressed={mailDetailExpanded} onClick={() => setMailDetailExpanded((current) => !current)} style={{ height: 36, borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", padding: "0 12px", fontWeight: 700, cursor: "pointer" }}>{mailDetailExpanded ? "분할 보기" : "상세 전체 보기"}</button><button type="button" onClick={openNewMailCompose} style={{ height: 36, borderRadius: 12, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 14px", fontWeight: 800, cursor: "pointer" }}>메일 작성</button></div>
                  </div>
                  <p style={{ color: "#475569", lineHeight: 1.7 }}>
                    {selectedMailDetail
                      ? selectedMailDetail.bodyText || selectedMailDetail.subject
                      : "받은편지함 또는 보낸편지함 목록에서 메일을 선택하면 상세 본문을 확인할 수 있습니다."}
                  </p>
                  <p style={{ color: "#64748b", fontSize: 14 }}>
                    발신자 {selectedMailDetail?.senderEmail || "-"} / 수신 {selectedMailDetail?.recipients.map((item) => item.recipientEmail).join(", ") || "-"}
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" disabled={!selectedMailDetail} onClick={() => openMailComposeFromDetail("reply")} style={{ padding: "9px 12px", borderRadius: 999, border: 0, cursor: "pointer" }}>
                      답장
                    </button>
                    <button type="button" disabled={!selectedMailDetail} onClick={() => openMailComposeFromDetail("forward")} style={{ padding: "9px 12px", borderRadius: 999, border: 0, cursor: "pointer" }}>
                      전달
                    </button>
                    <button
                      type="button"
                      aria-label="mail-detail-read-action"
                      onClick={() => void handleSelectedMailReadAction()}
                      style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13, border: 0, cursor: "pointer" }}
                    >
                      {selectedMailSummary?.isRead ? "읽음 상태 확인" : "읽음 처리"}
                    </button>
                    <button
                      type="button"
                      aria-label="mail-detail-star-action"
                      onClick={() => void toggleSelectedMailStar()}
                      style={{ padding: "9px 12px", borderRadius: 999, background: "#fff7ed", color: "#b45309", fontWeight: 700, fontSize: 13, border: 0, cursor: "pointer" }}
                    >
                      {selectedMailSummary?.isStarred ? "중요 해제" : "중요 표시"}
                    </button>
                    <span style={{ padding: "9px 12px", borderRadius: 999, background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 13 }}>
                      첨부 {selectedMailDetail?.attachmentCount ?? 0}
                    </span>
                    <span style={{ padding: "9px 12px", borderRadius: 999, background: "#f0fdf4", color: "#166534", fontWeight: 700, fontSize: 13 }}>
                      {selectedMailDetail ? (inferMailboxFromMailId(selectedMailId || selectedMailDetail.mailId) === "sent" ? "보낸편지함" : "받은편지함") : localMailArchiveHint || "받은편지함"}
                    </span>
                    {selectedMailDetail?.externalDeliveries?.length ? (
                      <span style={{ padding: "9px 12px", borderRadius: 999, background: "#eef2ff", color: "#4338ca", fontWeight: 700, fontSize: 13 }}>
                        외부 발송 {selectedMailDetail.externalDeliveries.length}건
                      </span>
                    ) : null}
                    {activeMailFolder === "localArchive" ? (
                      <span style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
                        {localMailArchiveHint}
                      </span>
                    ) : null}
                  </div>
                  {selectedMailDetail?.externalDeliveries?.length ? (
                    <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                      {selectedMailDetail.externalDeliveries.map((item) => (
                        <div key={item.queueId} style={{ borderRadius: 16, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <strong style={{ color: "#0f172a" }}>{item.recipient}</strong>
                            <span style={{ color: item.status === "sent" ? "#166534" : item.status === "failed" ? "#b91c1c" : "#4338ca", fontWeight: 800 }}>{item.status}</span>
                          </div>
                          <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>
                            provider {item.provider} / attempt {item.attemptCount}
                          </div>
                          {item.lastError ? <div style={{ marginTop: 6, color: "#b91c1c", fontSize: 13 }}>{item.lastError}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {mailError && selectedMailId ? <FeedbackState state="error" title="메일을 처리하지 못했습니다." message={mailError} action={{ label: "다시 시도", onAction: () => void selectMail(token, selectedMailId, inferMailboxFromMailId(selectedMailId)) }} /> : null}
                </>
              )}
            </article>
              )}
            />
          </section>
        );
      }

      if (activePortalMenu === "schedule") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "320px minmax(420px, 1fr)", gap: 18, minHeight: 0 }}>
            <aside style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>일정 요약</div>
              <h2 style={{ margin: "10px 0 0" }}>오늘 일정</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {[
                  { title: "오전 점검", time: "09:30", state: "운영 확인" },
                  { title: "결재 마감 확인", time: "13:00", state: `${dashboardStats.pendingApprovals}건 대기` },
                  { title: "알림 점검", time: "16:00", state: `미확인 ${dashboardStats.unreadCount}건` },
                ].map((item) => (
                  <article key={`${item.time}-${item.title}`} style={{ borderRadius: 16, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 14 }}>
                    <div style={{ fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 6, color: "#475569" }}>{item.time}</div>
                    <div style={{ marginTop: 8, color: "#0f766e", fontWeight: 700 }}>{item.state}</div>
                  </article>
                ))}
              </div>
            </aside>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>업무 일정 보기</div>
              <h2 style={{ margin: "10px 0 0" }}>마감과 협업 일정</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {[
                  "메일 확인과 결재 처리 흐름을 일정 우선순위에 맞춰 정렬합니다.",
                  "긴 설명 대신 오늘 처리해야 할 업무와 마감 시각만 먼저 보여줍니다.",
                  "정책 경로는 Help / 설정에서 확인합니다.",
                ].map((item) => (
                  <div key={item} style={{ borderRadius: 16, border: "1px solid #dbe4ec", background: "#fff", padding: 14, color: "#334155", lineHeight: 1.6 }}>
                    {item}
                  </div>
                ))}
              </div>
            </article>
          </section>
        );
      }

      if (activePortalMenu === "contacts") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "280px minmax(420px, 1fr)", gap: 18, minHeight: 0 }}>
            <aside style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>주소록 요약</div>
              <h2 style={{ margin: "10px 0 0" }}>주소록 업무 보기</h2>
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
              <h2 style={{ margin: "10px 0 0" }}>조직도 업무 보기</h2>
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
              <h2 style={{ margin: "10px 0 0" }}>파일 업무 보기</h2>
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
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>파일 연계</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 22 }}>설치형 연동 보기</h3>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>
                첨부 파일과 공유 항목은 설치형 연동으로 확인합니다.
              </p>
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
        const filteredDocuments = documents.filter((document) => {
          const statusMatches = approvalStatusFilter === "all" || document.status === approvalStatusFilter;
          const keyword = approvalSearch.trim().toLowerCase();
          return statusMatches && (!keyword || `${document.title} ${document.creatorUserName}`.toLowerCase().includes(keyword));
        });
        const selectedDocument = documents.find((document) => document.id === selectedApprovalId) ?? filteredDocuments[0] ?? null;
        const selectedApprovers = createForm.approverUserIds
          .map((userId) => approvalApprovers.find((user) => user.userId === userId))
          .filter((user): user is ApprovalApprover => Boolean(user));
        const availableApprovers = approvalApprovers.filter((user) => {
          const keyword = approverSearch.trim().toLowerCase();
          return !createForm.approverUserIds.includes(user.userId) && (!keyword || `${user.userName} ${user.departmentName} ${user.userEmail}`.toLowerCase().includes(keyword));
        });
        const openActionModal = (mode: ApprovalModalMode) => {
          if (!selectedDocument) return;
          setReasonAction({ documentId: selectedDocument.id, reason: "" });
          setApprovalError("");
          setApprovalModal(mode);
        };
        return (
          <section style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 14, minHeight: 0, height: "100%" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 18, border: "1px solid #dbe4ec", background: "#fff" }}>
              <div>
                <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800 }}>전자결재</div>
                <strong style={{ display: "block", marginTop: 4, fontSize: 20 }}>문서 목록과 선택 상세</strong>
              </div>
              <button aria-label="새 결재 작성" type="button" disabled={!canAct.create} onClick={() => void openApprovalEditor("create")} style={{ height: 36, borderRadius: 12, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 14px", fontWeight: 800 }}>새 결재 작성</button>
            </header>
            {approvalError && approvalModal === "none" ? <FeedbackState state="error" title="결재 정보를 처리하지 못했습니다." message={approvalError} action={{ label: "다시 시도", onAction: () => void reload() }} /> : null}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 0.9fr) minmax(420px, 1.1fr)", gap: 14, minHeight: 0 }}>
              <section aria-label="결재 목록" style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", gap: 10, padding: 14, borderRadius: 20, border: "1px solid #dbe4ec", background: "#fff" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[["all", "전체"], ["draft", "초안"], ["submitted", "상신"], ["rejected", "반려"], ["approved", "완료"]].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setApprovalStatusFilter(value)} style={{ height: 30, borderRadius: 999, border: approvalStatusFilter === value ? `1px solid ${uiContract.brand.primary}` : "1px solid #cbd5e1", background: approvalStatusFilter === value ? "#ecfdf5" : "#fff", padding: "0 10px", fontSize: 12, fontWeight: 700 }}>{label}</button>
                  ))}
                </div>
                <input aria-label="결재 검색" value={approvalSearch} onChange={(event) => setApprovalSearch(event.target.value)} placeholder="제목 또는 기안자 검색" style={{ height: 34, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 10px" }} />
                <div style={{ minHeight: 0, overflowY: "auto", display: "grid", gap: 8, alignContent: "start" }}>
                  {filteredDocuments.map((document) => {
                    const currentLine = document.lines.find((line) => line.sequence === document.currentLineIndex);
                    return <button key={document.id} type="button" onDoubleClick={() => void selectApprovalDocument(document.id)} onClick={() => void selectApprovalDocument(document.id)} style={{ textAlign: "left", padding: 12, borderRadius: 14, border: selectedDocument?.id === document.id ? `1px solid ${uiContract.brand.primary}` : "1px solid #dbe4ec", background: selectedDocument?.id === document.id ? "#f0fdfa" : "#fff", cursor: "pointer" }}>
                      <strong>{document.title}</strong>
                      <div style={{ marginTop: 5, display: "flex", justifyContent: "space-between", gap: 8, color: "#475569", fontSize: 12 }}><span>{document.creatorUserName}</span><span>{document.status}</span></div>
                      <div style={{ marginTop: 4, color: "#64748b", fontSize: 11 }}>현재 결재자: {currentLine?.approverUserName ?? "-"} · {formatDateLabel(document.updatedAt)}</div>
                    </button>;
                  })}
                  {!filteredDocuments.length ? <div style={{ padding: 16, border: "1px dashed #cbd5e1", borderRadius: 12, color: "#64748b" }}>표시할 결재 문서가 없습니다.</div> : null}
                </div>
              </section>
              <section aria-label="결재 상세" style={{ minHeight: 0, overflowY: "auto", padding: 18, borderRadius: 20, border: "1px solid #dbe4ec", background: "#fff" }}>
                {selectedDocument ? <>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><div><div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800 }}>선택 문서</div><h2 style={{ margin: "6px 0 0", fontSize: 22 }}>{selectedDocument.title}</h2></div><span style={{ padding: "5px 9px", borderRadius: 999, background: "#e2e8f0", fontSize: 12, fontWeight: 800 }}>{selectedDocument.status}</span></div>
                  <p style={{ whiteSpace: "pre-wrap", color: "#334155", lineHeight: 1.6 }}>{selectedDocument.content}</p>
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}><strong>결재선</strong>{selectedDocument.lines.map((line) => <div key={line.id} style={{ marginTop: 7, fontSize: 12, color: "#475569" }}>{line.sequence}. {line.approverUserName} · {line.status}{line.comment ? ` · ${line.comment}` : ""}</div>)}</div>
                  <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {selectedDocument.creatorUserId === me?.userId && selectedDocument.status === "draft" && canAct.create ? <button type="button" onClick={() => void openApprovalEditor("edit", selectedDocument)}>수정</button> : null}
                    {selectedDocument.creatorUserId === me?.userId && selectedDocument.status === "draft" && canAct.submit ? <button type="button" onClick={() => openActionModal("submit")}>상신</button> : null}
                    {selectedDocument.creatorUserId === me?.userId && selectedDocument.status === "submitted" && canAct.withdraw ? <button type="button" onClick={() => openActionModal("withdraw")}>회수</button> : null}
                    {selectedDocument.creatorUserId === me?.userId && (selectedDocument.status === "rejected" || selectedDocument.status === "withdrawn") && canAct.rework ? <button type="button" onClick={() => openActionModal("redraft")}>재기안</button> : null}
                    {isCurrentApprover(selectedDocument) && canAct.act ? <button type="button" onClick={() => openActionModal("approve")}>승인</button> : null}
                    {isCurrentApprover(selectedDocument) && canAct.act ? <button type="button" onClick={() => openActionModal("reject")}>반려</button> : null}
                  </div>
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}><strong>처리 이력</strong>{approvalLogs.length ? approvalLogs.map((log) => <div key={log.id} style={{ marginTop: 7, color: "#64748b", fontSize: 12 }}>{log.event} · {log.actorUserName} · {formatDateLabel(log.createdAt)}</div>) : <div style={{ marginTop: 7, color: "#64748b", fontSize: 12 }}>이력을 불러오는 중이거나 아직 없습니다.</div>}</div>
                </> : <div style={{ color: "#64748b" }}>목록에서 결재 문서를 선택하세요.</div>}
              </section>
            </div>
            {approvalModal !== "none" ? <div role="dialog" aria-modal="true" aria-label={`결재 ${approvalModal} 팝업`} style={{ position: "fixed", inset: 0, zIndex: 30, display: "grid", placeItems: "center", padding: 20, background: "rgba(15, 23, 42, 0.42)" }}>
              <div style={{ width: "min(760px, 92vw)", maxHeight: "88vh", overflowY: "auto", borderRadius: 20, padding: 20, background: "#fff", boxShadow: "0 24px 64px rgba(15,23,42,.25)" }}>
                {(approvalModal === "create" || approvalModal === "edit") ? <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}><div style={{ display: "flex", justifyContent: "space-between" }}><strong>{approvalModal === "create" ? "새 결재 작성" : "초안 수정"}</strong><button type="button" onClick={closeApprovalModal}>닫기</button></div><input aria-label="결재 제목" required value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} placeholder="결재 제목" style={{ height: 36, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 10px" }} /><textarea aria-label="결재 본문" required value={createForm.content} onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))} placeholder="내용" style={{ minHeight: 120, borderRadius: 10, border: "1px solid #cbd5e1", padding: 10 }} /><div><strong>결재선</strong><input aria-label="결재선 사용자 검색" value={approverSearch} onChange={(event) => setApproverSearch(event.target.value)} placeholder="이름, 부서, 이메일 검색" style={{ display: "block", width: "100%", boxSizing: "border-box", height: 34, marginTop: 8, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 10px" }} /><div style={{ maxHeight: 120, overflowY: "auto", marginTop: 8, display: "grid", gap: 6 }}>{availableApprovers.map((user) => <button type="button" key={user.userId} onClick={() => selectApprovalApprover(user.userId)} style={{ textAlign: "left", padding: 8, border: "1px solid #dbe4ec", borderRadius: 8, background: "#fff" }}>{user.userName} · {user.departmentName} · {user.userEmail}</button>)}</div><div aria-label="선택된 결재선" style={{ marginTop: 10, display: "grid", gap: 6 }}>{selectedApprovers.map((user, index) => <div key={user.userId} style={{ display: "flex", gap: 6, alignItems: "center", padding: 8, borderRadius: 8, background: "#f0fdfa" }}><span style={{ flex: 1 }}>{index + 1}. {user.userName} ({user.departmentName})</span><button type="button" onClick={() => moveApprovalApprover(user.userId, -1)}>위</button><button type="button" onClick={() => moveApprovalApprover(user.userId, 1)}>아래</button><button type="button" onClick={() => setCreateForm((current) => ({ ...current, approverUserIds: current.approverUserIds.filter((id) => id !== user.userId) }))}>제거</button></div>)}</div></div>{approvalError ? <div role="alert" className="common-popup-error">{approvalError}</div> : null}<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" onClick={closeApprovalModal}>취소</button><button type="submit" disabled={loading}>{approvalModal === "create" ? "초안 저장" : "수정 저장"}</button></div></form> : <div style={{ display: "grid", gap: 12 }}><strong>{({ submit: "상신 확인", approve: "승인", reject: "반려", withdraw: "회수 확인", redraft: "재기안 확인" } as Record<string, string>)[approvalModal]}</strong><div>{selectedDocument?.title}</div>{(approvalModal === "approve" || approvalModal === "reject") ? <textarea aria-label="처리 의견" value={reasonAction.reason} onChange={(event) => setReasonAction((current) => ({ ...current, reason: event.target.value }))} placeholder={approvalModal === "reject" ? "반려 의견 (필수)" : "처리 의견"} style={{ minHeight: 96, borderRadius: 10, border: "1px solid #cbd5e1", padding: 10 }} /> : null}{approvalError ? <div role="alert" className="common-popup-error">{approvalError}</div> : null}<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" onClick={closeApprovalModal}>취소</button><button type="button" disabled={loading} onClick={() => { if (!selectedDocument) return; if (approvalModal === "approve") void executeApprove(selectedDocument.id, true); else if (approvalModal === "reject") void executeApprove(selectedDocument.id, false); else void executeSubmit(selectedDocument.id, approvalModal as "submit" | "withdraw" | "redraft"); }}>{approvalModal === "approve" ? "승인" : approvalModal === "reject" ? "반려" : "확인"}</button></div></div>}
              </div>
            </div> : null}
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
          <NotificationCenter
            token={token}
            onChanged={() => refreshNotifications(token)}
            onNavigate={(menu, item) => { void openNotificationTarget(menu, item); }}
          />
        );
      }

      if (activePortalMenu === "settings") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "minmax(360px, 0.9fr) minmax(420px, 1.1fr)", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>사용자 설정</div>
              <h2 style={{ marginTop: 10 }}>언어 / 시간대 / 연결 정보</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#475569", fontWeight: 700 }}>언어</span>
                  <select value={locale} onChange={(event) => saveLocale(resolveLocale(event.target.value))}>
                    {supportedLocales.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#475569", fontWeight: 700 }}>시간대</span>
                  <select value={timezone} onChange={(event) => saveTimezone(event.target.value)}>
                    {supportedTimezones.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec", padding: 14 }}>
                  <div style={{ color: "#475569", fontWeight: 700 }}>API Base</div>
                  <div style={{ marginTop: 8, color: "#334155", wordBreak: "break-all" }}>{apiBase}</div>
                </div>
              </div>
            </article>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>설정 반영</div>
              <h2 style={{ marginTop: 10 }}>화면 계약 반영 상태</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {settingsContractCards.map((item) => (
                  <div key={item.title} style={{ padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                    <strong>{item.title}</strong>
                    <p style={{ marginBottom: 0, color: "#475569", lineHeight: 1.6 }}>{item.body}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        );
      }

      if (activePortalMenu === "help") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <h2 style={{ marginTop: 0 }}>Help / 정책 안내</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>정책 본문은 업무 홈에 직접 노출하지 않고 {uiContract.helpText} 경로에서 확인합니다.</p>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>메일: {MAIL_POLICY.serverRetention} / {MAIL_POLICY.localRetention}</p>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>메신저: {MESSENGER_POLICY.serverRetention} / {MESSENGER_POLICY.localRetention}</p>
            </article>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <h2 style={{ marginTop: 0 }}>정책 경로</h2>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec", color: "#475569", lineHeight: 1.6 }}>메일 보관 정책은 Help 및 설정 경로에서 확인합니다.</div>
                <div style={{ padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec", color: "#475569", lineHeight: 1.6 }}>로그인 후 업무 화면에는 정책 본문을 길게 노출하지 않습니다.</div>
              </div>
            </article>
          </section>
        );
      }

      return <UserHome
        userName={me.userName}
        loading={homeLoading}
        error={homeError || mailError || approvalError || messengerError}
        mails={inboxMails}
        approvals={documents}
        schedules={homeSchedules}
        rooms={messengerRoomsData}
        notices={homeNotices}
        onOpenList={(target) => setPortalMenu(target)}
        onOpenItem={(target, itemId) => void openHomeItem(target, itemId)}
      />;
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
        className="user-shell"
        style={{
          height: "100vh",
          overflow: "hidden",
          background: "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%), linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
        }}
      >
        <div className="user-shell-layout" style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 20, height: "100%", padding: 24, overflow: "hidden" }}>
          <aside className="user-app-rail" style={{ borderRadius: 30, padding: 22, background: "linear-gradient(180deg, #102a43 0%, #0f172a 100%)", color: "#e2e8f0", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, overflow: "hidden", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: "#7dd3fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>{uiContract.company.name} Portal</div>
                <h1 style={{ margin: "10px 0 6px", fontSize: 30, lineHeight: 1.08, letterSpacing: "-0.04em" }}>사용자 업무 홈</h1>
                <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.65 }}>{uiContract.company.domain}</p>
              </div>
            </div>
            <p style={{ margin: "14px 0 0", color: "rgba(226,232,240,0.72)", lineHeight: 1.65 }}>업무 처리 중심의 그룹웨어 홈입니다.</p>
            <nav className="user-app-rail-menu" aria-label="업무 메뉴" style={{ display: "grid", gap: 8, marginTop: 24 }}>
              {portalMenus.map((item) => (
                <button className="user-app-rail-item" key={item.key} type="button" aria-current={activePortalMenu === item.key ? "page" : undefined} onClick={() => setPortalMenu(item.key)} style={{ borderRadius: 16, padding: "12px 14px", border: activePortalMenu === item.key ? "1px solid #7dd3fc" : "1px solid rgba(255,255,255,0.05)", background: activePortalMenu === item.key ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.04)", color: "#e2e8f0", textAlign: "left", cursor: "pointer" }}>
                  <span style={{ display: "block", fontWeight: 800 }}>{item.label}</span>
                  <small style={{ color: "rgba(226,232,240,0.64)" }}>{item.desc}</small>
                </button>
              ))}
            </nav>
          </aside>

          <section style={{ minWidth: 0, height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 16, overflow: "hidden" }}>
            <header className="user-shell-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 22px", borderRadius: 26, background: "rgba(255,255,255,0.9)", border: "1px solid rgba(148, 163, 184, 0.18)" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, overflow: "hidden", background: "#eff6ff", border: "1px solid #d7e0e8" }}>
                    <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: uiContract.brand.primary }}>{uiContract.company.name} 업무 허브</div>
                    <div style={{ marginTop: 6, fontSize: 30, fontWeight: 900, letterSpacing: "-0.04em" }}>{me?.userName}님, 우선순위를 확인하세요</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input ref={searchInputRef} className="user-global-search" aria-label="통합 검색" value={searchText} onFocus={() => { if (searchText.trim()) setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") closeUnifiedSearch(); }} onChange={(event) => setSearchText(event.target.value)} placeholder="통합 검색" style={{ width: 300, height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px" }} />
                {searchText ? <button type="button" className="user-search-clear" aria-label="검색 지우기" onClick={closeUnifiedSearch}>지우기</button> : null}
                {notificationError && !showNotificationPanel ? <div className="feedback-shell-warning"><CompactWarning item={{ id: "notification-load", source: "notifications", tone: "warning", title: "알림 연결 확인 필요", message: notificationError, action: { label: "다시 시도", onAction: () => void loadNotificationData(token) } }} onDismiss={() => setNotificationError("")} /></div> : null}
                <button ref={notificationButtonRef} className="user-notification-entry" type="button" aria-label={`알림, 미확인 ${notificationSummary?.unreadCount ?? 0}건`} aria-controls="recent-notification-panel" aria-expanded={showNotificationPanel} onClick={toggleNotificationPanel} style={{ height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 12px", fontWeight: 700, cursor: "pointer" }}>알림 {(notificationSummary?.unreadCount ?? 0) > 0 ? <span aria-hidden="true">{notificationSummary?.unreadCount}</span> : null}</button>
                {uiContract.quickComposeVisible && activePortalMenu !== "home" ? (
                  <button
                    type="button"
                    onClick={() => void openQuickCompose()}
                    style={{ height: 46, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 16px", fontWeight: 800 }}
                  >
                    빠른 작성
                  </button>
                ) : null}
                <button type="button" onClick={refreshUiContract} style={{ height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px", fontWeight: 700 }}>설정 반영</button>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, padding: "0 12px", borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff" }}>
                  <div style={{ display: "grid", gap: 2, lineHeight: 1.1 }}>
                    <strong>{me.userName}</strong>
                    <span style={{ color: "#64748b", fontSize: 11 }}>{me.roleName || "역할 미지정"} / {me.userEmail}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearUserToken();
                      setToken("");
                      setMe(null);
                    }}
                    style={{ height: 34, borderRadius: 12, border: 0, background: "#0f172a", color: "#fff", padding: "0 12px", fontWeight: 800, cursor: "pointer" }}
                  >
                    로그아웃
                  </button>
                </div>
              </div>
            </header>
            {searchOpen ? (
              <div className="user-search-backdrop">
                <button type="button" className="user-search-dismiss" aria-label="검색 바깥 영역 닫기" onClick={closeUnifiedSearch} />
                <section className="user-search-panel" role="dialog" aria-label="통합 검색 결과">
                  <div className="user-search-panel-header">
                    <div><strong>통합 검색</strong><span>{searchText.trim()}</span></div>
                    <button type="button" aria-label="검색 닫기" onClick={closeUnifiedSearch}>닫기</button>
                  </div>
                  <div className="user-search-filters" role="group" aria-label="검색 유형 필터">
                    {([["all", "전체"], ["mail", "메일"], ["approval", "결재"], ["messenger", "메신저"], ["schedule", "일정"], ["contacts", "주소록"], ["org", "조직도"], ["files", "파일"]] as const).map(([type, label]) => (
                      <button key={type} type="button" data-search-filter={type} aria-pressed={searchFilter === type} onClick={() => setSearchFilter(type)}>{label} {type === "all" ? searchResults.length : searchResults.filter((item) => item.type === type).length}</button>
                    ))}
                  </div>
                  <div className="user-search-result-list">
                    {searchLoading ? <div className="user-search-state">검색 중입니다.</div> : null}
                    {!searchLoading && searchError ? <div className="user-search-error" role="alert">{searchError}</div> : null}
                    {!searchLoading && !searchError && searchResults.filter((item) => searchFilter === "all" || item.type === searchFilter).length === 0 ? <div className="user-search-state">검색 결과가 없습니다.</div> : null}
                    {!searchLoading && !searchError ? searchResults.filter((item) => searchFilter === "all" || item.type === searchFilter).map((item) => (
                      <button key={`${item.type}-${item.id}`} type="button" className="user-search-result" onClick={() => openSearchResult(item)}>
                        <span>{item.type}</span><strong>{item.title}</strong><small>{item.detail}</small>
                      </button>
                    )) : null}
                  </div>
                  <button type="button" className="user-search-all" onClick={() => setSearchFilter("all")}>전체 결과</button>
                </section>
              </div>
            ) : null}
            {showNotificationPanel ? (
              <div className="user-notification-backdrop">
                <button type="button" className="user-notification-dismiss" aria-label="알림 바깥 영역 닫기" onClick={closeNotificationPanel} />
                <aside id="recent-notification-panel" className="user-notification-panel" role="dialog" aria-labelledby="recent-notification-title" aria-modal="false" onKeyDown={event => { if (event.key === "Escape") closeNotificationPanel(); }}>
                  <div className="user-notification-panel-header">
                    <div>
                      <strong id="recent-notification-title">최근 알림</strong>
                      <span>읽지 않음 {notificationSummary?.unreadCount ?? 0}건</span>
                    </div>
                    <button type="button" aria-label="알림 닫기" autoFocus onClick={closeNotificationPanel}>닫기</button>
                  </div>
                  {notificationError ? <div className="user-notification-panel-error" role="alert">{notificationError}</div> : null}
                  <div className="user-notification-panel-list" aria-busy={loading || notificationLoading}>
                    {loading ? <div className="user-notification-empty">알림을 처리하는 중입니다.</div> : null}
                    {notificationLoading && notifications.length === 0 ? <div className="user-notification-empty">알림을 불러오는 중입니다.</div> : null}
                    {notifications.slice(0, 5).map(item => {
                      const value = (item.resourceType || item.category).toLowerCase();
                      const menu = value.includes("mail") ? "mail" : value.includes("approval") ? "approval" : value.includes("message") || value.includes("room") ? "messenger" : value.includes("schedule") || value.includes("calendar") ? "schedule" : value.includes("file") ? "files" : value.includes("notice") ? "notices" : "alerts";
                      return <button key={item.notificationId} type="button" className={`user-notification-row ${item.status === "unread" ? "is-unread" : ""}`} onClick={() => void openNotificationTarget(menu, item)}>
                        <span>{item.category}</span>
                        <strong>{item.title}</strong>
                        <small>{new Date(item.occurredAt).toLocaleString("ko-KR")} · {item.status === "unread" ? "읽지 않음" : "읽음"}</small>
                      </button>;
                    })}
                    {!notificationLoading && notifications.length === 0 ? <div className="user-notification-empty">최근 알림이 없습니다.</div> : null}
                  </div>
                  <div className="user-notification-panel-actions">
                    <button type="button" onClick={() => void executeReadAll()} disabled={loading || notificationLoading || !(notificationSummary?.unreadCount ?? 0)}>모두 읽음</button>
                    <button type="button" className="user-notification-all" onClick={() => { closeNotificationPanel(); setPortalMenu("alerts"); }}>전체 알림 보기</button>
                  </div>
                </aside>
              </div>
            ) : null}
            <section className="user-shell-content" style={{ minHeight: 0, overflow: "hidden", position: "relative" }}>
              {renderWorkPanel()}
            </section>
          </section>
          <ConfirmModal
            open={mailComposeCloseConfirmOpen}
            title="작성 중인 메일 닫기"
            message="저장하지 않은 받는 사람, 제목, 본문이 사라집니다."
            confirmLabel="저장하지 않고 닫기"
            onCancel={() => setMailComposeCloseConfirmOpen(false)}
            onConfirm={resetMailCompose}
          />
          <ConfirmModal
            open={mailDeleteConfirmOpen}
            title="메일 삭제 확인"
            message={<><strong>{selectedMailIds.length}개 메일</strong>을 삭제 상태로 전환합니다. 처리 후 목록을 다시 불러옵니다.</>}
            confirmLabel="선택 메일 삭제"
            busy={mailBulkBusy}
            onCancel={() => setMailDeleteConfirmOpen(false)}
            onConfirm={async () => {
              const completed = await runBulkMailAction("delete");
              if (completed) setMailDeleteConfirmOpen(false);
            }}
          />
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
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  fontSize: 13,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 10, overflow: "hidden", display: "inline-block", background: "rgba(255,255,255,0.16)" }}>
                  <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </span>
                {uiContract.company.name} Groupware
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
                <p style={{ margin: 0, color: "#115e59", fontSize: 13, fontWeight: 700 }}>Help / 정책 안내로 주요 설정을 안내합니다.</p>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 20,
                  background: "#f8fafc",
                  border: "1px solid #dbe4ec",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "#ffffff",
                    border: "1px solid #dbe4ec",
                    flexShrink: 0,
                  }}
                >
                  <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{uiContract.company.name}</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "#475569" }}>{uiContract.company.domain}</div>
                </div>
              </div>

              <form onSubmit={handleLogin} style={{ display: "grid", gap: 14, marginTop: 24 }}>
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>아이디</span>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
                    <input
                      value={loginForm.loginId}
                      onChange={(event) => setLoginForm((current) => ({ ...current, loginId: normalizeLoginIdInput(event.target.value) }))}
                      placeholder="admin"
                      style={{
                        height: 54,
                        borderRadius: 16,
                        border: "1px solid #cbd5e1",
                        padding: "0 16px",
                        font: "inherit",
                        background: "#fff",
                      }}
                    />
                    <span style={{ height: 54, display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: 16, border: "1px solid #dbe4ec", background: "#f8fafc", color: "#475569", fontSize: 13, fontWeight: 700 }}>
                      @{uiContract.company.domain}
                    </span>
                  </div>
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
                정책 경로: `Help`, `정책 안내`, `설정 &gt; 보관 정책`
              </div>
            </article>

            {approvalError ? (
              <FeedbackState state="error" title="로그인할 수 없습니다." message={approvalError} />
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
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, overflow: "hidden", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </div>
              <div>
                <div style={{ fontSize: 14, color: "#7dd3fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>{uiContract.company.name} Portal</div>
                <h1 style={{ margin: "14px 0 8px", fontSize: 32, lineHeight: 1.08, letterSpacing: "-0.04em" }}>사용자 업무 홈</h1>
                <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.5 }}>{uiContract.company.domain}</p>
              </div>
            </div>
            <p style={{ margin: "14px 0 0", color: "rgba(226,232,240,0.72)", lineHeight: 1.5 }}>
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
                <div>정책 경로: {uiContract.helpText}</div>
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
                  <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
                    <div style={{ color: "#475569", fontSize: 13 }}>결재 작성과 결재선 선택은 별도 팝업에서 처리합니다.</div>
                    <button
                      type="button"
                      onClick={() => void openApprovalEditor("create")}
                      style={{ height: 44, borderRadius: 14, border: 0, background: "linear-gradient(135deg, #0f766e 0%, #0f172a 100%)", color: "#fff", fontWeight: 800, cursor: "pointer" }}
                    >
                      새 결재 작성 열기
                    </button>
                  </div>
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

<ToastViewport items={feedbackItems} onDismiss={dismissFeedback} />
    </main>
  );
}
