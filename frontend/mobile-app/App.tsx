import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, BackHandler, Button, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createMobileSessionAdapter, isSessionInvalidatedError, requestJson } from "./auth-session";
import { buildMonthGrid, buildSchedulePayload, createSubmissionGate, filterSchedulesForMonth, monthKeyForDate, selectDefaultCalendar, scheduleErrorMessage, scheduleItems, shiftMonthKey, dateKey } from "./schedule-api";
import { createDirectoryActionGate, directoryUsers as readDirectoryUsers, directRoomPayload, filterDirectoryUsers, mailtoUrl } from "./directory-api";
import { buildPersonalAiChatPayload, buildPersonalAiConfigPayload, createPersonalAiActionGate, isPersonalAiConfigReady, personalAiErrorMessage, readPersonalAiChatResponse, readPersonalAiConfig, readPersonalAiConnectionTest, readPersonalAiModelList, readPersonalAiProviders } from "./personal-ai-api";
import { normalizeBusinessSearchText, searchLoadedBusinessSummaries, updateBusinessSearchWarnings } from "./business-search";

const { aiViewModel, approvalViewModel, buildHomeViewModel, calendarViewModel, directoryViewModel, navigationModel } = require("./mobile-ui-design.js");
const { buildMailSendPayload, mailboxRequestPath, mailboxViewModel } = require("./mail-compose.js");
const { formatMailSender, resolveMailSenderDisplayMode } = require("./mail-sender-display.js");
const { buildTranslationPayload, messengerViewModel } = require("./messenger-translation.js");
const mobileNavigation = navigationModel();
const { createSettingsHistory } = require("./mobile-navigation.js");
const { buildRoomCreatePayload } = require("./messenger-compose.js");
const { withMobileTypography } = require("./mobile-typography.js");

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
  senderDisplayName: string;
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
  senderDisplayName: string;
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

type MailBasicPreferences = { senderDisplayMode: "name" | "id" | "name_email" };
type SenderDisplayMode = MailBasicPreferences["senderDisplayMode"];

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
  translationLocale: string;
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
type DirectoryUser = { id: string; name: string; email: string; department_name: string; role_name: string };
type WorkspaceSchedule = { id: string; title: string; starts_at: string; ends_at?: string; description?: string; location?: string };
type ScheduleForm = { title: string; startsAt: string; endsAt: string; description: string; location: string };
type BusinessSearchSource = "mail" | "approval" | "messenger" | "schedule" | "directory" | "file";
type BusinessSearchCategory = BusinessSearchSource;
type BusinessSearchResult = {
  category: BusinessSearchCategory;
  id: string;
  title: string;
  summary: string;
  target: { screen: "mail" | "approval" | "chat" | "calendar" | "directory" | "files"; id: string };
};

type AppLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-CN" | "es-ES" | "fr-FR" | "de-DE";
type MobileTab = "home" | "mail" | "approval" | "chat" | "calendar" | "more" | "files";
type ScreenKey = MobileTab | "directory" | "ai" | "search" | "settings";
type MailboxTab = "inbox" | "starred" | "sent" | "drafts";
type ApprovalView = "draft" | "progress" | "complete";
type PersonalAiProviderOption = { provider: string; label: string; apiKeyRequired: boolean };
type PersonalAiConnectionStatus = "unconfigured" | "untested" | "ready" | "error";
type PersonalAiConfigSource = "personal" | "admin_default" | "unconfigured";
type PersonalAiConfig = { provider: string; model: string; apiKeyConfigured: boolean; connectionStatus: PersonalAiConnectionStatus; lastTestCode: string | null; lastTestedAt: string | null; configSource: PersonalAiConfigSource };
type PersonalAiModelList = { success: boolean; provider: string; models: string[]; code: string; message: string; loadedAt: string };
type PersonalAiConnectionTest = { success: boolean; provider: string; model: string; code: string; message: string; connectionStatus: PersonalAiConnectionStatus; testedAt: string };
type PersonalAiChatResponse = { provider: string; model: string; message: { role: "assistant"; content: string }; generatedAt: string };
type IconName = "home" | "mail" | "approval" | "chat" | "calendar" | "directory" | "ai" | "search" | "settings" | "more" | "files";

const iconGlyphs: Record<IconName, string> = {
  home: "⌂", mail: "✉", approval: "✓", chat: "◌", calendar: "▣", directory: "♙", ai: "✦", search: "⌕", settings: "⚙", more: "•••", files: "▤",
};

function MoaIcon({ name, color = "#0f766e", size = 18 }: { name: IconName; color?: string; size?: number }) {
  return <Text accessibilityLabel={`${name} 아이콘`} style={{ color, fontSize: size, lineHeight: size + 2, fontWeight: "800", textAlign: "center" }}>{iconGlyphs[name]}</Text>;
}

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
const BUSINESS_SEARCH_CATEGORY_LABELS: Record<BusinessSearchCategory, string> = {
  mail: "메일",
  approval: "결재",
  messenger: "메신저",
  schedule: "일정",
  directory: "주소록",
  file: "파일",
};

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
  const [mailSenderDisplayMode, setMailSenderDisplayMode] = useState<SenderDisplayMode>("name");
  const [selectedMailId, setSelectedMailId] = useState("");
  const [selectedMailDetail, setSelectedMailDetail] = useState<MailDetail | null>(null);
  const [mailDetailExpanded, setMailDetailExpanded] = useState(false);
  const [mailError, setMailError] = useState("");
  const [mailQuery, setMailQuery] = useState("");
  const [mailFilter, setMailFilter] = useState<"all" | "unread" | "starred">("all");
  const [mailboxTab, setMailboxTab] = useState<MailboxTab>("inbox");
  const [mailComposeOpen, setMailComposeOpen] = useState(false);
  const [mailComposeForm, setMailComposeForm] = useState({ to: "", subject: "", bodyText: "" });
  const [mailSendPending, setMailSendPending] = useState(false);
  const mailSendGateRef = useRef(false);
  const [rooms, setRooms] = useState<MessengerRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [roomMessages, setRoomMessages] = useState<MessengerMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatTranslationPending, setChatTranslationPending] = useState(false);
  const chatTranslationGateRef = useRef(false);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [fileError, setFileError] = useState("");
  const [calendars, setCalendars] = useState<WorkspaceCalendar[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>({ title: "", startsAt: "", endsAt: "", description: "", location: "" });
  const [scheduleMonthKey, setScheduleMonthKey] = useState(() => monthKeyForDate(new Date(), timezone));
  const [selectedScheduleDateKey, setSelectedScheduleDateKey] = useState(() => dateKey(new Date().toISOString(), timezone));
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const scheduleSubmissionGateRef = useRef(createSubmissionGate());
  const visibleSchedules = useMemo(() => filterSchedulesForMonth(schedules, scheduleMonthKey, timezone), [schedules, scheduleMonthKey, timezone]);
  const [moreScreen, setMoreScreen] = useState<Exclude<ScreenKey, MobileTab>>("directory");
  const [moreMenuOpen, setMoreMenuOpen] = useState(true);
  const settingsHistoryRef = useRef(createSettingsHistory());
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const [roomCreateForm, setRoomCreateForm] = useState({ roomType: "direct", roomName: "", participantUserIds: [] as string[] });
  const [roomCreateQuery, setRoomCreateQuery] = useState("");
  const [roomCreateError, setRoomCreateError] = useState("");
  const [roomCreatePending, setRoomCreatePending] = useState(false);
  const [roomDirectoryLoading, setRoomDirectoryLoading] = useState(false);
  const [roomDirectoryError, setRoomDirectoryError] = useState("");
  const roomDirectoryRequestRef = useRef(0);
  const roomCreateGateRef = useRef(false);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directorySection, setDirectorySection] = useState<"all" | "favorites" | "recent">("all");
  const [directoryError, setDirectoryError] = useState("");
  const [directoryBusyUserId, setDirectoryBusyUserId] = useState("");
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState("");
  const [employeeSearchResults, setEmployeeSearchResults] = useState<DirectoryUser[]>([]);
  const [employeeSearchOpen, setEmployeeSearchOpen] = useState(false);
  const directoryActionGateRef = useRef(createDirectoryActionGate());
  const visibleDirectoryUsers = useMemo(() => filterDirectoryUsers(directoryUsers, directoryQuery), [directoryUsers, directoryQuery]);
  function runEmployeeSearch() {
    setEmployeeSearchResults(filterDirectoryUsers(directoryUsers, employeeSearchQuery));
    setEmployeeSearchOpen(true);
  }
  const [businessSearchQuery, setBusinessSearchQuery] = useState("");
  const [businessSearchSelectedResultId, setBusinessSearchSelectedResultId] = useState("");
  const [businessSearchWarnings, setBusinessSearchWarnings] = useState<BusinessSearchSource[]>([]);
  const businessSearchResults = useMemo(() => searchLoadedBusinessSummaries(businessSearchQuery, {
    mailItems,
    documents,
    rooms,
    schedules,
    directoryUsers,
    files,
  }) as BusinessSearchResult[], [businessSearchQuery, mailItems, documents, rooms, schedules, directoryUsers, files]);
  const businessSearchCategoryCounts = useMemo(() => (Object.keys(BUSINESS_SEARCH_CATEGORY_LABELS) as BusinessSearchCategory[])
    .map((category) => ({ category, count: businessSearchResults.filter((result) => result.category === category).length }))
    .filter((item) => item.count > 0), [businessSearchResults]);
  const businessSearchHasQuery = normalizeBusinessSearchText(businessSearchQuery).length > 0;
  const [screenDensity, setScreenDensity] = useState<"standard" | "compact">("standard");
  const [personalAiProviders, setPersonalAiProviders] = useState<PersonalAiProviderOption[]>([]);
  const [llmProvider, setLlmProvider] = useState("openai");
  const [llmModel, setLlmModel] = useState("");
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmConfigSource, setLlmConfigSource] = useState<PersonalAiConfigSource>("unconfigured");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmApiKeyConfigured, setLlmApiKeyConfigured] = useState(false);
  const [llmConnectionStatus, setLlmConnectionStatus] = useState<PersonalAiConnectionStatus>("unconfigured");
  const [personalAiTestReady, setPersonalAiTestReady] = useState(false);
  const [personalAiConfigDirty, setPersonalAiConfigDirty] = useState(false);
  const [llmLastTestedAt, setLlmLastTestedAt] = useState<string | null>(null);
  const [personalAiError, setPersonalAiError] = useState("");
  const [personalAiPendingAction, setPersonalAiPendingAction] = useState("");
  const personalAiActionGateRef = useRef(createPersonalAiActionGate());
  const [aiDraft, setAiDraft] = useState("");
  const [aiMessages, setAiMessages] = useState<Array<{ role: "user" | "assistant"; body: string }>>([]);
  const sessionControllerRef = useRef(createMobileSessionAdapter({
    onLoginCommitted({ token: nextToken, user: nextUser }) {
      resetMobileOverlays();
      setMailSenderDisplayMode("name");
      setToken(nextToken);
      setMe(nextUser);
      scheduleSubmissionGateRef.current.reset();
      setScheduleSaving(false);
      setSelectedScheduleDateKey(dateKey(new Date().toISOString(), timezone));
      setScheduleFormOpen(false);
      directoryActionGateRef.current.reset();
      setDirectoryBusyUserId("");
      personalAiActionGateRef.current.reset();
      setPersonalAiPendingAction("");
      setPersonalAiTestReady(false);
      setPersonalAiConfigDirty(false);
      setBusinessSearchQuery("");
      setBusinessSearchSelectedResultId("");
      setBusinessSearchWarnings([]);
      setApprovalView("progress");
      setSelectedApprovalId("");
      setApprovalComposeOpen(false);
      setDirectorySection("all");
      setMoreMenuOpen(true);
      setChatTranslationPending(false);
      chatTranslationGateRef.current = false;
      setMailboxTab("inbox");
      setMailComposeOpen(false);
      setMailComposeForm({ to: "", subject: "", bodyText: "" });
      setMailSendPending(false);
      mailSendGateRef.current = false;
    },
    onSessionReset(nextState) {
      resetMobileOverlays();
      setMailSenderDisplayMode("name");
      setToken(nextState.token);
      setMe(nextState.user);
      setPassword(nextState.password);
      setDocuments(nextState.documents);
      setCreateForm(nextState.createForm);
      setApprovalView("progress");
      setSelectedApprovalId("");
      setApprovalComposeOpen(false);
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
      setMailboxTab("inbox");
      setMailComposeOpen(false);
      setMailComposeForm({ to: "", subject: "", bodyText: "" });
      setMailSendPending(false);
      mailSendGateRef.current = false;
      setRooms(nextState.rooms);
      setSelectedRoomId(nextState.selectedRoomId);
      setRoomMessages(nextState.roomMessages);
      setChatDraft(nextState.chatDraft);
      setChatError(nextState.chatError);
      setChatTranslationPending(nextState.chatTranslationPending);
      chatTranslationGateRef.current = false;
      setFiles(nextState.files);
      setFileError(nextState.fileError);
      setCalendars(nextState.calendars);
      setSchedules(nextState.schedules);
      setScheduleError(nextState.scheduleError);
      setScheduleForm(nextState.scheduleForm);
      scheduleSubmissionGateRef.current.reset();
      setScheduleSaving(false);
      setSelectedScheduleDateKey(dateKey(new Date().toISOString(), timezone));
      setScheduleFormOpen(false);
      setDirectoryUsers(nextState.directoryUsers);
      setDirectoryQuery(nextState.directoryQuery);
      setDirectorySection("all");
      setMoreMenuOpen(true);
      setDirectoryError(nextState.directoryError);
      directoryActionGateRef.current.reset();
      setDirectoryBusyUserId(nextState.directoryBusyUserId);
      setBusinessSearchQuery(nextState.businessSearchQuery);
      setBusinessSearchSelectedResultId(nextState.businessSearchSelectedResultId);
      setBusinessSearchWarnings(nextState.businessSearchWarnings);
      setActionReason(nextState.actionReason);
      setPersonalAiProviders(nextState.personalAiProviders);
      setLlmProvider(nextState.llmProvider);
      setLlmModel(nextState.llmModel);
      setLlmModels(nextState.llmModels);
      setLlmConfigSource(nextState.llmConfigSource);
      setLlmApiKey(nextState.llmApiKey);
      setLlmApiKeyConfigured(nextState.llmApiKeyConfigured);
      setLlmConnectionStatus(nextState.llmConnectionStatus);
      setPersonalAiTestReady(nextState.personalAiTestReady);
      setPersonalAiConfigDirty(nextState.personalAiConfigDirty);
      setLlmLastTestedAt(nextState.llmLastTestedAt);
      setPersonalAiError(nextState.personalAiError);
      personalAiActionGateRef.current.reset();
      setPersonalAiPendingAction(nextState.personalAiPendingAction);
      setAiDraft(nextState.aiDraft);
      setAiMessages(nextState.aiMessages);
      setMessage(nextState.message);
    },
  }));
  const activeTabError = activeTab === "files" ? fileError : activeTab === "calendar" ? scheduleError : activeTab === "mail" ? mailError : activeTab === "chat" ? chatError : "";

  function markBusinessSearchSource(source: BusinessSearchSource, failed: boolean) {
    setBusinessSearchWarnings((current) => updateBusinessSearchWarnings(current, source, failed) as BusinessSearchSource[]);
  }

  async function loadPersonalAi(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken || personalAiConfigDirty || !sessionControllerRef.current.isCurrent(context)) return;
    const ticket = personalAiActionGateRef.current.tryEnter("load");
    if (!ticket) return;
    setPersonalAiPendingAction("load");
    setPersonalAiTestReady(false);
    try {
      await applyProtectedResponse(context, async () => {
        const [providersBody, configBody] = await Promise.all([
          request<{ providers: PersonalAiProviderOption[] }>("/workspace/personal-ai/providers", { headers: { Authorization: `Bearer ${activeToken}` } }, context),
          request<PersonalAiConfig>("/workspace/personal-ai/config", { headers: { Authorization: `Bearer ${activeToken}` } }, context),
        ]);
        return { providers: readPersonalAiProviders(providersBody), config: readPersonalAiConfig(configBody) };
      }, ({ providers, config }) => {
        setPersonalAiProviders(providers);
        setLlmProvider(config.provider || providers[0]?.provider || "openai");
        setLlmModel(config.model);
        setLlmModels(config.model ? [config.model] : []);
        setLlmConfigSource(config.configSource);
        setLlmApiKeyConfigured(config.apiKeyConfigured);
        setLlmConnectionStatus(config.connectionStatus);
        setLlmLastTestedAt(config.lastTestedAt);
        setPersonalAiTestReady(isPersonalAiConfigReady(config));
        setPersonalAiError("");
      });
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setPersonalAiError(personalAiErrorMessage(error));
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) {
        personalAiActionGateRef.current.release(ticket);
        setPersonalAiPendingAction("");
      }
    }
  }

  async function savePersonalAiConfig() {
    const context = sessionControllerRef.current.capture(token);
    if (!token || !sessionControllerRef.current.isCurrent(context)) return;
    const ticket = personalAiActionGateRef.current.tryEnter("save");
    if (!ticket) return;
    const apiKeyDraft = llmApiKey;
    setLlmApiKey("");
    setPersonalAiPendingAction("save");
    setPersonalAiError("");
    setPersonalAiTestReady(false);
    try {
      const payload = buildPersonalAiConfigPayload({ provider: llmProvider, model: llmModel, apiKeyDraft });
      await applyProtectedResponse(context, async () => readPersonalAiConfig(await request<PersonalAiConfig>("/workspace/personal-ai/config", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, context)), (config) => {
        setLlmProvider(config.provider);
        setLlmModel(config.model);
        setLlmApiKeyConfigured(config.apiKeyConfigured);
        setLlmConnectionStatus(config.connectionStatus);
        setLlmConfigSource(config.configSource);
        setLlmLastTestedAt(config.lastTestedAt);
        setPersonalAiConfigDirty(false);
        setMessage("개인 AI 설정이 저장되었습니다. 연결 시험을 실행해 주세요.");
      });
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setPersonalAiError(personalAiErrorMessage(error));
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) {
        personalAiActionGateRef.current.release(ticket);
        setPersonalAiPendingAction("");
      }
    }
  }

  async function loadPersonalAiModels() {
    const context = sessionControllerRef.current.capture(token);
    if (!token || !llmProvider || !sessionControllerRef.current.isCurrent(context)) return;
    const ticket = personalAiActionGateRef.current.tryEnter("models");
    if (!ticket) return;
    const selectedProvider = llmProvider;
    const apiKeyDraft = llmApiKey.trim();
    setPersonalAiPendingAction("models");
    setPersonalAiError("");
    try {
      await applyProtectedResponse(context, async () => readPersonalAiModelList(await request<PersonalAiModelList>("/workspace/personal-ai/models", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider, ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {}) }),
      }, context)), (result) => {
        if (selectedProvider !== llmProvider) return;
        setLlmModels(result.success ? result.models : []);
        if (!result.success) setPersonalAiError(result.message);
        else if (!result.models.includes(llmModel)) setLlmModel("");
      });
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setPersonalAiError(personalAiErrorMessage(error));
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) {
        personalAiActionGateRef.current.release(ticket);
        setPersonalAiPendingAction("");
      }
    }
  }

  async function testPersonalAiConnection() {
    const context = sessionControllerRef.current.capture(token);
    if (!token || personalAiConfigDirty || !sessionControllerRef.current.isCurrent(context)) return;
    const ticket = personalAiActionGateRef.current.tryEnter("test");
    if (!ticket) return;
    setPersonalAiPendingAction("test");
    setPersonalAiError("");
    setPersonalAiTestReady(false);
    try {
      await applyProtectedResponse(context, async () => readPersonalAiConnectionTest(await request<PersonalAiConnectionTest>("/workspace/personal-ai/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, context)), (result) => {
        setLlmProvider(result.provider);
        setLlmModel(result.model);
        setLlmConnectionStatus(result.connectionStatus);
        setPersonalAiTestReady(result.success && result.connectionStatus === "ready");
        setLlmLastTestedAt(result.testedAt);
        setMessage(result.message);
        setPersonalAiError(result.success && result.connectionStatus === "ready" ? "" : result.message);
      });
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) {
        setLlmConnectionStatus("error");
        setPersonalAiTestReady(false);
        setPersonalAiError(personalAiErrorMessage(error));
      }
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) {
        personalAiActionGateRef.current.release(ticket);
        setPersonalAiPendingAction("");
      }
    }
  }

  async function askAi() {
    const context = sessionControllerRef.current.capture(token);
    if (!token || !personalAiTestReady || !sessionControllerRef.current.isCurrent(context)) return;
    const ticket = personalAiActionGateRef.current.tryEnter("chat");
    if (!ticket) return;
    const prompt = aiDraft.trim();
    try {
      const payload = buildPersonalAiChatPayload(aiMessages, prompt);
      setPersonalAiPendingAction("chat");
      setPersonalAiError("");
      setAiDraft("");
      setAiMessages((current) => [...current, { role: "user", body: prompt }]);
      await applyProtectedResponse(context, async () => readPersonalAiChatResponse(await request<PersonalAiChatResponse>("/workspace/personal-ai/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, context)), (result) => {
        setLlmProvider(result.provider);
        setLlmModel(result.model);
        setAiMessages((current) => [...current, { role: "assistant", body: result.message.content }]);
      });
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setPersonalAiError(personalAiErrorMessage(error));
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) {
        personalAiActionGateRef.current.release(ticket);
        setPersonalAiPendingAction("");
      }
    }
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
        () => loadDirectory(loginResult.login.accessToken, context),
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
      markBusinessSearchSource("approval", false);
      setMessage("");
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      markBusinessSearchSource("approval", true);
      setMessage(error instanceof Error ? error.message : "조회 실패");
    }
  }

  async function loadMail(activeToken: string = token, preferredMailId?: string, context = sessionControllerRef.current.capture(activeToken), mailbox: MailboxTab = mailboxTab) {
    if (!activeToken) return;
    try {
      const inboxResponse = await applyProtectedResponse(context, () => request<{ mails: MailSummary[] }>(mailboxRequestPath(mailbox), {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (body) => {
        setMailItems(body.mails ?? []);
      });
      if (!inboxResponse.applied) return;
      const inbox = inboxResponse.value;
      const mails = inbox.mails ?? [];
      const targetMailId = preferredMailId || selectedMailId || mails[0]?.mailId || "";
      if (targetMailId) {
        const detailView = mailbox === "sent" ? "sent" : mailbox === "drafts" ? "draft" : "inbox";
        const detailResponse = await applyProtectedResponse(context, () => request<MailDetail>(`/mail/${targetMailId}?view=${detailView}`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        }, context), (detail) => {
          setSelectedMailId(targetMailId);
          setSelectedMailDetail(detail);
          setMailDetailExpanded(false);
          setMailError("");
        });
        if (!detailResponse.applied) return;
      } else {
        setSelectedMailId("");
        setSelectedMailDetail(null);
        setMailDetailExpanded(false);
        setMailError("");
      }
      markBusinessSearchSource("mail", false);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      markBusinessSearchSource("mail", true);
      const nextError = error instanceof Error ? error.message : "메일 조회 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  async function openMail(mailId: string, activeToken: string = token) {
    if (!activeToken) return;
    const context = sessionControllerRef.current.capture(activeToken);
    try {
      if (mailboxTab === "inbox" || mailboxTab === "starred") {
        const readResponse = await applyProtectedResponse(context, () => request(`/mail/${mailId}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${activeToken}` },
        }, context), () => {});
        if (!readResponse.applied) return;
      }
      const detailView = mailboxTab === "sent" ? "sent" : mailboxTab === "drafts" ? "draft" : "inbox";
      const detailResponse = await applyProtectedResponse(context, () => request<MailDetail>(`/mail/${mailId}?view=${detailView}`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (detail) => {
        setSelectedMailId(mailId);
        setSelectedMailDetail(detail);
        setMailDetailExpanded(true);
        if (mailboxTab === "inbox" || mailboxTab === "starred") {
          setMailItems((current) => current.map((item) => (item.mailId === mailId ? { ...item, isRead: true } : item)));
        }
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
      await loadMail(activeToken, mailId, context, mailboxTab);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "중요 표시 실패";
      setMailError(nextError);
      setMessage(nextError);
    }
  }

  function selectMailbox(nextMailbox: MailboxTab) {
    setMailboxTab(nextMailbox);
    setMailFilter(nextMailbox === "starred" ? "starred" : "all");
    setSelectedMailId("");
    setSelectedMailDetail(null);
    setMailDetailExpanded(false);
    if (token) void loadMail(token, undefined, sessionControllerRef.current.capture(token), nextMailbox);
  }

  async function performSendMail(payload: ReturnType<typeof buildMailSendPayload>, activeToken: string, context: { generation: number; token: string }) {
    if (mailSendGateRef.current || !sessionControllerRef.current.isCurrent(context)) return;
    mailSendGateRef.current = true;
    setMailSendPending(true);
    try {
      await request("/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setMailComposeForm({ to: "", subject: "", bodyText: "" });
      setMailComposeOpen(false);
      setMailboxTab("sent");
      setMailFilter("all");
      setMailError("");
      setMessage("메일을 발송했습니다.");
      await loadMail(activeToken, undefined, context, "sent");
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "메일 발송 실패";
      setMailError(nextError);
      setMessage(nextError);
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) setMailSendPending(false);
      mailSendGateRef.current = false;
    }
  }

  function confirmSendMail() {
    if (!token || mailSendPending || mailSendGateRef.current) return;
    try {
      const payload = buildMailSendPayload(mailComposeForm);
      const context = sessionControllerRef.current.capture(token);
      setMailError("");
      Alert.alert(
        "메일 발송",
        `${payload.to[0]}에게 메일을 발송하시겠습니까?`,
        [
          { text: "취소", style: "cancel" },
          { text: "발송", onPress: () => { void performSendMail(payload, token, context); } },
        ],
      );
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "메일 내용을 확인해 주세요.");
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
      markBusinessSearchSource("messenger", false);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      markBusinessSearchSource("messenger", true);
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
      markBusinessSearchSource("file", false);
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      markBusinessSearchSource("file", true);
      setFileError(error instanceof Error ? error.message : "파일 조회 실패");
    }
  }

  async function loadSchedules(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const [calendarBody, scheduleBody] = await Promise.all([
        request<{ owned: WorkspaceCalendar[] }>("/workspace/calendars", { headers: { Authorization: `Bearer ${activeToken}` } }, context),
        request<{ items: WorkspaceSchedule[] }>("/workspace/schedules", { headers: { Authorization: `Bearer ${activeToken}` } }, context),
      ]);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setCalendars(calendarBody.owned ?? []);
      setSchedules(scheduleItems(scheduleBody));
      setScheduleError("");
      markBusinessSearchSource("schedule", false);
    } catch (error) {
      if (isSessionInvalidatedError(error) || !sessionControllerRef.current.isCurrent(context)) return;
      markBusinessSearchSource("schedule", true);
      setScheduleError(scheduleErrorMessage(error));
    }
  }

  async function loadDirectory(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    try {
      const body = await request<{ users: DirectoryUser[] }>("/workspace/directory", { headers: { Authorization: `Bearer ${activeToken}` } }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setDirectoryUsers(readDirectoryUsers(body));
      setDirectoryError("");
      markBusinessSearchSource("directory", false);
    } catch (error) {
      if (isSessionInvalidatedError(error) || !sessionControllerRef.current.isCurrent(context)) return;
      markBusinessSearchSource("directory", true);
      setDirectoryError(error instanceof Error ? error.message : "주소록 조회 실패");
    }
  }

  function resetMobileOverlays() {
    settingsHistoryRef.current.reset();
    setRoomCreateOpen(false);
    setRoomCreateForm({ roomType: "direct", roomName: "", participantUserIds: [] });
    setRoomCreateQuery("");
    setRoomCreateError("");
    setRoomCreatePending(false);
    setRoomDirectoryLoading(false);
    setRoomDirectoryError("");
    roomDirectoryRequestRef.current += 1;
    roomCreateGateRef.current = false;
  }

  function openSettings() {
    settingsHistoryRef.current.enter({ activeTab, moreScreen, moreMenuOpen });
    setActiveTab("more");
    setMoreScreen("settings");
    setMoreMenuOpen(false);
    if (token && !personalAiConfigDirty) void loadPersonalAi(token);
  }

  function leaveSettings() {
    const previous = settingsHistoryRef.current.back();
    setActiveTab(previous.activeTab);
    setMoreScreen(previous.moreScreen);
    setMoreMenuOpen(previous.moreMenuOpen);
  }

  useEffect(() => {
    if (!me || activeTab !== "more" || moreScreen !== "settings" || moreMenuOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      leaveSettings();
      return true;
    });
    return () => subscription.remove();
  }, [me, activeTab, moreScreen, moreMenuOpen]);

  function openRoomComposer() {
    setRoomCreateForm({ roomType: "direct", roomName: "", participantUserIds: [] });
    setRoomCreateQuery("");
    setRoomCreateError("");
    setRoomCreateOpen(true);
    setDirectoryUsers([]);
    setRoomDirectoryLoading(true);
    setRoomDirectoryError("");
    const requestGeneration = roomDirectoryRequestRef.current + 1;
    roomDirectoryRequestRef.current = requestGeneration;
    const context = sessionControllerRef.current.capture(token);
    void request<{ users: DirectoryUser[] }>("/workspace/directory", { headers: { Authorization: `Bearer ${token}` } }, context)
      .then((body) => {
        if (!sessionControllerRef.current.isCurrent(context) || roomDirectoryRequestRef.current !== requestGeneration) return;
        setDirectoryUsers(readDirectoryUsers(body));
      })
      .catch((error) => {
        if (isSessionInvalidatedError(error) || !sessionControllerRef.current.isCurrent(context) || roomDirectoryRequestRef.current !== requestGeneration) return;
        setRoomDirectoryError(error instanceof Error ? error.message : "참여자 조회 실패");
      })
      .finally(() => {
        if (sessionControllerRef.current.isCurrent(context) && roomDirectoryRequestRef.current === requestGeneration) setRoomDirectoryLoading(false);
      });
  }

  function toggleRoomParticipant(id: string) {
    setRoomCreateError("");
    setRoomCreateForm((current) => ({ ...current, participantUserIds: current.roomType === "direct"
      ? [id]
      : current.participantUserIds.includes(id) ? current.participantUserIds.filter((item) => item !== id) : [...current.participantUserIds, id] }));
  }

  async function submitRoomCreate() {
    if (roomCreateGateRef.current) return;
    const context = sessionControllerRef.current.capture(token);
    try {
      const payload = buildRoomCreatePayload(roomCreateForm, directoryUsers, me?.userId);
      roomCreateGateRef.current = true;
      setRoomCreatePending(true);
      setRoomCreateError("");
      const body = await request<{ roomId: string }>("/messenger/rooms", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      if (!body.roomId) throw new Error("대화방 생성 결과를 확인하지 못했습니다.");
      setRoomCreateOpen(false);
      setActiveTab("chat");
      await loadRooms(token, body.roomId, context);
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setRoomCreateError(error instanceof Error ? error.message : "대화방 생성 실패");
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) { roomCreateGateRef.current = false; setRoomCreatePending(false); }
    }
  }

  async function loadMailSenderDisplayPreference(activeToken: string = token, context = sessionControllerRef.current.capture(activeToken)) {
    if (!activeToken) return;
    setMailSenderDisplayMode("name");
    try {
      const preferencesResponse = await applyProtectedResponse(context, () => request<MailBasicPreferences>("/mail/preferences/basic", {
        headers: { Authorization: `Bearer ${activeToken}` },
      }, context), (preferences) => {
        setMailSenderDisplayMode(resolveMailSenderDisplayMode(preferences));
      });
      if (!preferencesResponse.applied) return;
    } catch (error) {
      if (isSessionInvalidatedError(error) || !sessionControllerRef.current.isCurrent(context)) return;
      setMailSenderDisplayMode("name");
    }
  }

  async function startDirectRoom(member: DirectoryUser) {
    if (!directoryActionGateRef.current.tryEnter(member.id)) return;
    const context = sessionControllerRef.current.capture(token);
    try {
      setDirectoryBusyUserId(member.id);
      const body = await request<{ roomId: string }>("/messenger/rooms", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(directRoomPayload(member)) }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setActiveTab("chat");
      await loadRooms(token, body.roomId, context);
    } catch (error) {
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setDirectoryError(error instanceof Error ? error.message : "대화방 생성 실패");
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) { directoryActionGateRef.current.release(member.id); setDirectoryBusyUserId(""); }
    }
  }

  function openDirectoryMail(email: string) { const url = mailtoUrl(email); const context = sessionControllerRef.current.capture(token); if (url) void Linking.openURL(url).catch(() => { if (sessionControllerRef.current.isCurrent(context)) setDirectoryError("메일 앱을 열 수 없습니다."); }); }

  async function createSchedule() {
    if (!scheduleSubmissionGateRef.current.tryEnter()) return;
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
      if (!isSessionInvalidatedError(error) && sessionControllerRef.current.isCurrent(context)) setScheduleError(scheduleErrorMessage(error));
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) { scheduleSubmissionGateRef.current.release(); setScheduleSaving(false); }
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
      loadDirectory(activeToken, context),
      loadPersonalAi(activeToken, context),
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

  function openBusinessSearchResult(result: BusinessSearchResult) {
    setBusinessSearchSelectedResultId(`${result.category}:${result.id}`);
    if (result.target.screen === "mail") {
      setActiveTab("mail");
      void openMail(result.id);
      return;
    }
    if (result.target.screen === "chat") {
      setActiveTab("chat");
      void openRoom(result.id);
      return;
    }
    if (result.target.screen === "approval") {
      setActiveTab("approval");
      return;
    }
    if (result.target.screen === "calendar") {
      setActiveTab("calendar");
      return;
    }
    if (result.target.screen === "directory") {
      setActiveTab("more");
      setMoreScreen("directory");
      setMoreMenuOpen(false);
      return;
    }
    if (result.target.screen === "files") {
      setActiveTab("files");
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

  async function updateRoomTranslation(localeValue: string) {
    if (!token || !selectedRoomId || chatTranslationPending || chatTranslationGateRef.current) return;
    let payload: { translationLocale: string };
    try {
      payload = buildTranslationPayload(localeValue);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "번역 언어를 확인해 주세요.");
      return;
    }
    const context = sessionControllerRef.current.capture(token);
    chatTranslationGateRef.current = true;
    setChatTranslationPending(true);
    setChatError("");
    try {
      await request(`/messenger/rooms/${selectedRoomId}/translation`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, context);
      if (!sessionControllerRef.current.isCurrent(context)) return;
      setRooms((current) => current.map((room) => room.roomId === selectedRoomId ? { ...room, translationLocale: payload.translationLocale } : room));
    } catch (error) {
      if (isSessionInvalidatedError(error)) return;
      if (!sessionControllerRef.current.isCurrent(context)) return;
      const nextError = error instanceof Error ? error.message : "번역 언어 변경 실패";
      setChatError(nextError);
      setMessage(nextError);
    } finally {
      if (sessionControllerRef.current.isCurrent(context)) setChatTranslationPending(false);
      chatTranslationGateRef.current = false;
    }
  }

  function handleTabPress(nextTab: MobileTab) {
    setActiveTab(nextTab);
    if (nextTab === "more") setMoreMenuOpen(true);
    if (!token) return;
    if (nextTab === "more" && moreScreen === "directory") {
      void loadDirectory(token);
      return;
    }
    if (nextTab === "mail") {
      void loadMailSenderDisplayPreference(token);
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

  function changeScheduleMonth(amount: number) {
    const nextMonth = shiftMonthKey(scheduleMonthKey, amount);
    setScheduleMonthKey(nextMonth);
    setSelectedScheduleDateKey(`${nextMonth}-01`);
  }

  function selectTodaySchedule() {
    const today = dateKey(new Date().toISOString(), timezone);
    setScheduleMonthKey(today.slice(0, 7));
    setSelectedScheduleDateKey(today);
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
  const mailView = mailboxViewModel({ items: mailItems, filter: mailboxTab === "starred" ? "starred" : mailFilter, query: mailQuery });
  const visibleMailItems = mailView.rows as MailSummary[];
  const todayKey = dateKey(new Date().toISOString(), timezone);
  const homeView = buildHomeViewModel({
    userName: me?.userName || "",
    mailItems,
    documents,
    todaySchedules: schedules.filter((item) => dateKey(item.starts_at, timezone) === todayKey),
    rooms,
  });
  const approvalScreen = approvalViewModel({ documents, view: approvalView, selectedId: selectedApprovalId }) as { tabs: string[]; rows: Approval[]; selected: Approval | null };
  const selectedApproval = approvalScreen.selected;
  const messengerScreen = messengerViewModel({ rooms, selectedRoomId, messages: roomMessages }) as { selectedRoom: MessengerRoom | null; messages: MessengerMessage[]; languageOptions: Array<{ value: string; label: string }> };
  const calendarScreen = calendarViewModel({ cells: buildMonthGrid(scheduleMonthKey), schedules: visibleSchedules, selectedDateKey: selectedScheduleDateKey, timezone }) as { columns: number; weekdayLabels: string[]; cells: Array<{ dateKey: string; day: number | null }>; selectedDateKey: string; selectedSchedules: WorkspaceSchedule[] };
  const directoryScreen = directoryViewModel({ users: visibleDirectoryUsers, query: "", section: directorySection }) as { sections: string[]; rows: DirectoryUser[] };
  const aiScreen = aiViewModel({ messages: aiMessages, provider: llmProvider, connectionStatus: llmConnectionStatus }) as { providerLabel: string; ready: boolean; messages: Array<{ role: "user" | "assistant"; body: string }> };
  const [approvalView, setApprovalView] = useState<ApprovalView>("progress");
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [approvalComposeOpen, setApprovalComposeOpen] = useState(false);
  const activeTabLabel = activeTab === "home" ? "홈" : activeTab === "mail" ? "메일" : activeTab === "approval" ? "결재" : activeTab === "chat" ? "메신저" : activeTab === "calendar" ? "일정" : activeTab === "files" ? "파일" : mobileNavigation.more.find((item: { id: string }) => item.id === moreScreen)?.label || "더보기";

  return (
    <SafeAreaView style={styles.safe}>
      {me ? (
        <View style={styles.mobileShellHeader}>
          {activeTab === "more" && moreScreen === "settings" && !moreMenuOpen ? (
            <Pressable accessibilityRole="button" accessibilityLabel="설정 이전 화면으로" onPress={leaveSettings} style={styles.settingsBackButton}>
              <Text style={styles.backGlyph}>‹</Text><Text style={styles.settingsBackText}>뒤로</Text>
            </Pressable>
          ) : null}
          <View>
            <Text style={styles.shellBrand}>MoaWorks</Text>
            <Text style={styles.shellTitle}>{activeTabLabel}</Text>
          </View>
          <View style={styles.shellHeaderActions}>
            <Text style={styles.shellHeaderChip}>알림 {notificationSummary?.unreadCount ?? 0}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="헤더 로그아웃" onPress={() => clearSession("로그아웃되었습니다.")}>
              <Text style={styles.shellHeaderChip}>로그아웃</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={[styles.container, screenDensity === "compact" ? styles.containerCompact : null]}>
        {!me ? (
          <View style={styles.hero}>
          <Text style={styles.heroKicker}>MoaWorks Mobile</Text>
          <Text style={styles.heroTitle}>사용자 업무 포털</Text>
          <Text style={styles.heroDesc}>메일, 결재, 메신저를 한 곳에서 이어가는 업무 포털입니다.</Text>
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
          {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        ) : null}

        {me ? (
          <>
            {(activeTab === "more" && moreMenuOpen) || activeTabError ? (
              <View style={styles.surfaceCard}>
              {activeTab === "more" && moreMenuOpen ? (
                <View style={styles.mobileSubNav}>
                  {mobileNavigation.more.map((item: { id: string; label: string; icon: IconName }) => (
                    <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} 메뉴`} accessibilityHint="선택한 더보기 화면으로 이동합니다." onPress={() => { if (item.id === "settings") { openSettings(); return; } setMoreScreen(item.id as Exclude<ScreenKey, MobileTab>); setMoreMenuOpen(false); if (item.id === "directory" && token) void loadDirectory(token); if (item.id === "ai" && !personalAiTestReady && token) void loadPersonalAi(token); }} style={[styles.mobileSubTab, moreScreen === item.id ? styles.mobileSubTabActive : styles.mobileSubTabIdle]}><MoaIcon name={item.icon as IconName} color={moreScreen === item.id ? "#ffffff" : "#0f766e"} /><Text style={[styles.mobileTabLabel, moreScreen === item.id ? styles.mobileTabLabelActive : null]}>{item.label}</Text></Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            ) : null}

            {activeTab === "calendar" ? (
              <View style={styles.calendarScreen}>
                <View style={styles.calendarToolbar}>
                  <Text accessibilityRole="button" accessibilityLabel="이전 달 일정 보기" accessibilityHint="표시 중인 달을 한 달 전으로 이동합니다." onPress={() => changeScheduleMonth(-1)} style={styles.calendarArrow}>‹</Text>
                  <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.calendarMonthTitle}>{`${Number(scheduleMonthKey.slice(0, 4))}년 ${Number(scheduleMonthKey.slice(5, 7))}월`}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="오늘 일정 보기" accessibilityHint="오늘 날짜와 일정으로 이동합니다." onPress={selectTodaySchedule} style={styles.calendarTodayButton}><Text style={styles.calendarTodayText}>오늘</Text></Pressable>
                  <Text accessibilityRole="button" accessibilityLabel="다음 달 일정 보기" accessibilityHint="표시 중인 달을 한 달 뒤로 이동합니다." onPress={() => changeScheduleMonth(1)} style={styles.calendarArrow}>›</Text>
                </View>
                <View style={styles.calendarWeekdays}>{calendarScreen.weekdayLabels.map((label, index) => <Text key={label} style={[styles.calendarWeekday, index === 0 ? styles.calendarSunday : null]}>{label}</Text>)}</View>
                <View style={styles.calendarGrid}>{calendarScreen.cells.map((cell, index) => {
                  const daySchedules = visibleSchedules.filter((item) => dateKey(item.starts_at, timezone) === cell.dateKey);
                  const selected = Boolean(cell.dateKey) && cell.dateKey === calendarScreen.selectedDateKey;
                  return <Pressable key={`${cell.dateKey}-${index}`} accessibilityRole={cell.dateKey ? "button" : undefined} accessibilityLabel={cell.dateKey ? `${cell.day}일 일정 ${daySchedules.length}건` : undefined} accessibilityHint={cell.dateKey ? "선택한 날짜의 일정 목록을 표시합니다." : undefined} disabled={!cell.dateKey} onPress={() => setSelectedScheduleDateKey(cell.dateKey)} style={styles.calendarCompactCell}><Text style={[styles.calendarCompactDate, index % 7 === 0 ? styles.calendarSunday : null, selected ? styles.calendarSelectedDate : null]}>{cell.day || ""}</Text>{daySchedules.length > 0 ? <View style={styles.calendarEventDot} /> : null}</Pressable>;
                })}</View>
                <View style={styles.selectedDayHeader}><Text style={styles.selectedDayTitle}>{calendarScreen.selectedDateKey ? `${Number(calendarScreen.selectedDateKey.slice(5, 7))}월 ${Number(calendarScreen.selectedDateKey.slice(8, 10))}일` : "선택일"}</Text><Text style={styles.selectedDayCount}>전체 {calendarScreen.selectedSchedules.length}건</Text></View>
                <View accessibilityLabel="선택일 일정 목록" style={styles.selectedScheduleList}>
                  {calendarScreen.selectedSchedules.map((item, index) => <View key={item.id} style={[styles.selectedScheduleRow, index === calendarScreen.selectedSchedules.length - 1 ? styles.selectedScheduleAlert : null]}><Text style={styles.selectedScheduleTime}>{formatStamp(item.starts_at).slice(-5)}</Text><View style={styles.selectedScheduleBody}><Text style={styles.selectedScheduleTitle}>{item.title}</Text><Text style={styles.selectedScheduleMeta}>{item.ends_at ? `${formatStamp(item.starts_at).slice(-5)} - ${formatStamp(item.ends_at).slice(-5)}` : formatStamp(item.starts_at)}{item.location ? ` · ${item.location}` : ""}</Text></View></View>)}
                  {calendarScreen.selectedSchedules.length === 0 ? <Text style={styles.calendarEmpty}>선택한 날짜에 일정이 없습니다.</Text> : null}
                </View>
                {scheduleFormOpen ? <View style={styles.scheduleComposeCard}>
                  <TextInput accessibilityLabel="일정 제목" accessibilityHint="생성할 일정의 제목을 입력합니다." style={styles.compactInput} value={scheduleForm.title} onChangeText={(title) => setScheduleForm((current) => ({ ...current, title }))} placeholder="일정 제목" />
                  <TextInput accessibilityLabel="일정 시작 시간" accessibilityHint="일정 시작 시각을 날짜와 시간 형식으로 입력합니다." style={styles.compactInput} value={scheduleForm.startsAt} onChangeText={(startsAt) => setScheduleForm((current) => ({ ...current, startsAt }))} placeholder="2026-08-24T09:00:00+09:00" />
                  <TextInput accessibilityLabel="일정 종료 시간" accessibilityHint="일정 종료 시각을 날짜와 시간 형식으로 입력합니다." style={styles.compactInput} value={scheduleForm.endsAt} onChangeText={(endsAt) => setScheduleForm((current) => ({ ...current, endsAt }))} placeholder="2026-08-24T10:00:00+09:00" />
                  <Pressable accessibilityRole="button" accessibilityLabel="일정 생성" disabled={scheduleSaving} onPress={() => { void createSchedule(); }} style={[styles.composeSendButton, scheduleSaving ? styles.buttonDisabled : null]}><Text style={styles.composeSendButtonText}>{scheduleSaving ? "저장 중" : "일정 저장"}</Text></Pressable>
                </View> : null}
                <Pressable accessibilityRole="button" accessibilityLabel="일정 만들기" accessibilityHint="새 일정 입력 양식을 열거나 닫습니다." onPress={() => setScheduleFormOpen((current) => !current)} style={styles.calendarCreateButton}><Text style={styles.calendarCreateText}>{scheduleFormOpen ? "닫기" : "＋ 일정 만들기"}</Text></Pressable>
                {scheduleError ? <Text accessibilityRole="alert" accessibilityLabel="일정 요청을 처리하지 못했습니다." style={styles.error}>{scheduleError}</Text> : null}
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "directory" ? (
              <View style={[styles.directoryScreen, styles.directoryScreenFlat]}>
                <Text accessibilityRole="header" style={styles.directoryScreenTitle}>주소록</Text>
                <TextInput accessibilityLabel="주소록 검색" accessibilityHint="이름, 부서, 역할 또는 이메일로 사원을 검색합니다." style={styles.directorySearchInput} value={directoryQuery} onChangeText={setDirectoryQuery} placeholder="이름, 부서, 직책 검색" />
                <View style={styles.directorySections}>{(["all", "favorites", "recent"] as const).map((section, index) => <Pressable key={section} accessibilityRole="button" accessibilityLabel={`${directoryScreen.sections[index]} 주소록 보기`} onPress={() => setDirectorySection(section)} style={[styles.directorySection, directorySection === section ? styles.directorySectionActive : null]}><Text style={[styles.directorySectionText, directorySection === section ? styles.directorySectionTextActive : null]}>{directoryScreen.sections[index]}</Text></Pressable>)}</View>
                <View style={styles.directoryListHeader}><Text style={styles.directoryListTitle}>{directorySection === "all" ? `전체 직원 (${directoryScreen.rows.length})` : directoryScreen.sections[["all", "favorites", "recent"].indexOf(directorySection)]}</Text></View>
                {directoryScreen.rows.map((member) => { const isSelf = member.id === me?.userId; return <View key={member.id} style={styles.directoryCompactRow}><View style={styles.directoryInitial}><Text style={styles.directoryInitialText}>{member.name.slice(0, 1)}</Text></View><View style={styles.directoryCompactInfo}><Text style={styles.directoryMemberName}>{member.name} <Text style={styles.directoryMemberRole}>{member.role_name}</Text></Text><Text style={styles.directoryDepartment}>{member.department_name}</Text></View><View style={styles.directoryActions}><Pressable accessibilityRole="button" accessibilityLabel={`${member.name} 전화번호 미제공`} accessibilityHint="전화번호가 없어 사용할 수 없습니다." onPress={() => {}} disabled={true} style={styles.directoryIconDisabled}><Text style={styles.directoryIcon}>⌕</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${member.name}에게 메일 보내기`} accessibilityHint="기본 메일 앱을 엽니다." onPress={() => openDirectoryMail(member.email)} disabled={!mailtoUrl(member.email)} style={styles.directoryIconButton}><Text style={styles.directoryIcon}>✉</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${member.name}와 대화 시작`} accessibilityHint="선택한 사원과 일대일 대화방을 엽니다." onPress={() => void startDirectRoom(member)} disabled={isSelf || directoryBusyUserId === member.id} style={[styles.directoryIconButton, isSelf || directoryBusyUserId === member.id ? styles.directoryIconDisabled : null]}><Text style={styles.directoryIcon}>◌</Text></Pressable></View></View>; })}
                {directoryError ? <Text accessibilityRole="alert" accessibilityLabel="주소록 요청을 처리하지 못했습니다." style={styles.directoryError}>{directoryError}</Text> : null}
                {directoryScreen.rows.length === 0 && !directoryError ? <Text accessibilityLiveRegion="polite" style={styles.emptyState}>표시할 주소록 정보가 없습니다.</Text> : null}
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "ai" ? (
              <View style={styles.aiScreen}>
                <View style={styles.aiHeader}><View><Text accessibilityRole="header" style={styles.aiTitle}>AI 채팅</Text><Text style={styles.aiProviderStatus}>{aiScreen.providerLabel || "PROVIDER"} · {llmConfigSource === "admin_default" ? "관리자 기본 LLM 사용 중" : aiScreen.ready ? "연결됨" : "연결 필요"}</Text></View><Text accessibilityRole="button" accessibilityLabel="개인 AI 설정 열기" onPress={openSettings} style={styles.aiSettingsAction}>⚙ 설정</Text></View>
                <View accessibilityLabel="AI 대화" style={styles.aiConversation}>
                  {aiScreen.messages.map((item, index) => <View key={`${item.role}-${index}`} style={[styles.aiMessageGroup, item.role === "user" ? styles.aiMessageGroupUser : null]}>{item.role === "assistant" ? <View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>M</Text></View> : null}<View style={[styles.aiMessageBubble, item.role === "user" ? styles.aiMessageUser : styles.aiMessageAssistant]}><Text style={item.role === "user" ? styles.aiMessageTextUser : styles.aiMessageTextAssistant}>{item.body}</Text></View></View>)}
                  {aiScreen.messages.length === 0 ? <View style={styles.aiMessageGroup}><View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>M</Text></View><View style={[styles.aiMessageBubble, styles.aiMessageAssistant]}><Text style={styles.aiMessageTextAssistant}>안녕하세요, MoaWorks AI입니다. 무엇을 도와드릴까요?</Text></View></View> : null}
                </View>
                <View style={styles.aiInputBar}><Text style={styles.aiAddButton}>＋</Text><TextInput accessibilityLabel="개인 AI 질문" accessibilityHint="개인 AI에게 보낼 질문을 입력합니다." style={styles.aiInput} value={aiDraft} onChangeText={setAiDraft} placeholder="무엇이든 물어보세요..." maxLength={8000} editable={!personalAiPendingAction} /><Pressable accessibilityRole="button" accessibilityLabel="개인 AI 질문 보내기" accessibilityHint="입력한 질문을 연결된 개인 AI에 보냅니다." disabled={!personalAiTestReady || Boolean(personalAiPendingAction) || !aiDraft.trim()} onPress={() => { void askAi(); }} style={[styles.aiSendButton, !personalAiTestReady || Boolean(personalAiPendingAction) || !aiDraft.trim() ? styles.buttonDisabled : null]}><Text style={styles.aiSendText}>{personalAiPendingAction === "chat" ? "…" : "➤"}</Text></Pressable></View>
                {!personalAiTestReady ? <Text accessibilityLiveRegion="polite" style={styles.aiReadinessNote}>현재 로그인 세션에서 연결 시험이 준비 상태가 되어야 질문을 보낼 수 있습니다.</Text> : null}
                {personalAiError ? <Text accessibilityRole="alert" accessibilityLabel="개인 AI 요청을 처리하지 못했습니다." style={styles.aiInlineError}>{personalAiError}</Text> : null}
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "search" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>업무 검색</Text>
                <Text accessibilityRole="header" style={styles.surfaceTitle}>현재 불러온 업무 통합 검색</Text>
                <Text style={styles.surfaceHint}>메일·결재·메신저·일정·주소록·파일의 현재 로드된 요약만 검색하며, 완전한 서버 전체 이력 검색이 아닙니다.</Text>
                <TextInput
                  accessibilityLabel="업무 검색어"
                  accessibilityHint="현재 로그인 세션에 불러온 업무 요약을 검색합니다."
                  style={styles.input}
                  value={businessSearchQuery}
                  onChangeText={(value) => { setBusinessSearchQuery(value); setBusinessSearchSelectedResultId(""); }}
                  placeholder="현재 불러온 업무 검색"
                  maxLength={200}
                />
                {businessSearchWarnings.length > 0 ? (
                  <Text accessibilityRole="alert" accessibilityLabel="일부 업무를 불러오지 못했습니다. 현재 불러온 결과만 표시합니다." accessibilityLiveRegion="polite" style={styles.error}>{`일부 업무를 불러오지 못했습니다: ${businessSearchWarnings.map((source) => BUSINESS_SEARCH_CATEGORY_LABELS[source]).join(", ")}. 현재 불러온 결과만 표시합니다.`}</Text>
                ) : null}
                {businessSearchHasQuery ? (
                  <>
                    <Text accessibilityLiveRegion="polite" style={styles.sectionLabel}>{`검색 결과 ${businessSearchResults.length}건`}</Text>
                    <View style={styles.providerRow}>
                      {businessSearchCategoryCounts.map(({ category, count }) => (
                        <Text key={category} style={[styles.providerChip, styles.providerChipActive]}>{`${BUSINESS_SEARCH_CATEGORY_LABELS[category]} ${count}건`}</Text>
                      ))}
                    </View>
                    {businessSearchResults.map((result) => (
                      <Pressable
                        key={`${result.category}:${result.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${BUSINESS_SEARCH_CATEGORY_LABELS[result.category]} ${result.title} 열기`}
                        accessibilityHint="선택한 업무 화면으로 이동합니다."
                        onPress={() => openBusinessSearchResult(result)}
                        style={[styles.listCard, businessSearchSelectedResultId === `${result.category}:${result.id}` ? styles.mailRowSelected : null]}
                      >
                        <Text style={styles.surfaceKicker}>{BUSINESS_SEARCH_CATEGORY_LABELS[result.category]}</Text>
                        <Text style={styles.listTitle}>{result.title}</Text>
                        <Text style={styles.listBody}>{result.summary || "요약 정보 없음"}</Text>
                      </Pressable>
                    ))}
                    {businessSearchResults.length === 0 ? <Text style={styles.emptyState}>현재 불러온 업무에서 일치하는 결과가 없습니다.</Text> : null}
                  </>
                ) : <Text style={styles.emptyState}>검색어를 입력하면 현재 불러온 업무에서 관련 결과를 표시합니다.</Text>}
              </View>
            ) : null}

            {activeTab === "more" && moreScreen === "settings" ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.surfaceKicker}>설정</Text><Text style={styles.surfaceTitle}>앱 기본 설정</Text>
                <Text style={styles.sectionLabel}>연결 서버</Text><TextInput style={styles.input} value={apiBase} onChangeText={setApiBase} autoCapitalize="none" />
                <Text style={styles.sectionLabel}>화면 언어</Text><Text style={styles.settingsValue}>{locale}</Text><Text style={styles.sectionLabel}>시간대</Text><Text style={styles.settingsValue}>{timezone}</Text>
                <Text style={styles.sectionLabel}>화면 밀도</Text><View style={styles.providerRow}><Text onPress={() => setScreenDensity("standard")} style={[styles.providerChip, screenDensity === "standard" ? styles.providerChipActive : null]}>표준</Text><Text onPress={() => setScreenDensity("compact")} style={[styles.providerChip, screenDensity === "compact" ? styles.providerChipActive : null]}>간결</Text></View>
                <Text style={styles.sectionLabel}>LLM Provider</Text>
                <View style={styles.providerRow}>{personalAiProviders.map((option) => <Pressable key={option.provider} accessibilityRole="button" accessibilityLabel={`${option.label} Provider 선택`} disabled={Boolean(personalAiPendingAction)} onPress={() => { if (option.provider !== llmProvider) { setLlmProvider(option.provider); setLlmModel(""); setLlmModels([]); setLlmConfigSource("personal"); setLlmApiKey(""); setLlmApiKeyConfigured(false); setLlmConnectionStatus("untested"); setPersonalAiTestReady(false); setPersonalAiConfigDirty(true); setLlmLastTestedAt(null); setPersonalAiError(""); } }} style={[styles.providerChip, llmProvider === option.provider ? styles.providerChipActive : null]}><Text>{option.label}</Text></Pressable>)}</View>
                {personalAiProviders.length === 0 ? <Text style={styles.surfaceHint}>Provider 목록을 불러오지 못했습니다.</Text> : null}
                <Button accessibilityLabel="개인 AI 모델 불러오기" title={personalAiPendingAction === "models" ? "모델 불러오는 중" : "모델 불러오기"} disabled={Boolean(personalAiPendingAction) || !llmProvider} onPress={() => { void loadPersonalAiModels(); }} />
                <View style={styles.providerRow}>{llmModels.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${item} 모델 선택`} disabled={Boolean(personalAiPendingAction)} onPress={() => { setLlmModel(item); setLlmConnectionStatus("untested"); setPersonalAiTestReady(false); setPersonalAiConfigDirty(true); }} style={[styles.providerChip, llmModel === item ? styles.providerChipActive : null]}><Text>{item}</Text></Pressable>)}</View>
                {llmModels.length === 0 ? <Text accessibilityLabel="개인 AI 모델" style={styles.surfaceHint}>모델 불러오기 후 선택하세요.</Text> : null}
                <TextInput accessibilityLabel="개인 AI API 키" accessibilityHint="개인 AI 연결에 사용할 API 키를 안전하게 입력합니다." style={styles.input} value={llmApiKey} onChangeText={(value) => { setLlmApiKey(value); setLlmConnectionStatus("untested"); setPersonalAiTestReady(false); setPersonalAiConfigDirty(true); }} placeholder={llmApiKeyConfigured ? "새 API 키를 입력할 때만 변경" : "개인 LLM API 키"} secureTextEntry autoCapitalize="none" maxLength={1000} editable={!personalAiPendingAction} />
                <Text accessibilityLiveRegion="polite" style={styles.surfaceHint}>{`설정 상태: ${llmApiKeyConfigured ? "API 키 설정됨" : "API 키 미설정"} · 연결 ${llmConnectionStatus} · 최근 시험 ${formatStamp(llmLastTestedAt)}`}</Text>
                <Button accessibilityLabel="개인 AI 연결 시험" title={personalAiPendingAction === "test" ? "연결 시험 중" : llmConnectionStatus === "ready" ? "연결됨 · 다시 시험" : "LLM 연결 시험"} disabled={Boolean(personalAiPendingAction) || llmConfigSource === "admin_default" || personalAiConfigDirty || !llmProvider || !llmModel.trim()} onPress={() => { void testPersonalAiConnection(); }} />
                <Button accessibilityLabel="개인 AI 설정 저장" title={personalAiPendingAction === "save" ? "설정 저장 중" : "개인 AI 설정 저장"} disabled={Boolean(personalAiPendingAction) || !llmProvider || !llmModel.trim()} onPress={() => { void savePersonalAiConfig(); }} />
                {personalAiError ? <Text accessibilityRole="alert" accessibilityLabel="개인 AI 요청을 처리하지 못했습니다." style={styles.error}>{personalAiError}</Text> : null}
                <View style={styles.settingsCompactSection}><Text style={styles.sectionLabel}>현재 사용자</Text><Text style={styles.settingsValue}>{me.userName} · {me.roleName}</Text><Text style={styles.settingsValue}>{me.userEmail}</Text></View>
                <View style={styles.settingsCompactSection}><View style={styles.moduleToolbar}><Text style={styles.sectionLabel}>알림 {notificationSummary?.unreadCount ?? 0}건</Text><Text accessibilityRole="button" accessibilityLabel="알림 새로고침" onPress={() => { void refreshNotifications(); }} style={styles.homeSectionLink}>새로고침</Text></View>{notifications.slice(0, 5).map((item) => <Pressable key={item.notificationId} accessibilityRole="button" accessibilityLabel={`${item.title} 알림 읽음 처리`} disabled={item.status !== "unread"} onPress={() => { void executeAckNotification(item.notificationId); }} style={styles.settingsNotificationRow}><Text style={styles.listTitle}>{item.title}</Text><Text style={styles.listBody}>{item.message}</Text></Pressable>)}{notificationError ? <Text accessibilityRole="alert" style={styles.error}>{notificationError}</Text> : null}</View>
                <View style={styles.settingsCompactSection}><Text style={styles.sectionLabel}>도움말</Text><Text style={styles.settingsValue}>정책 확인 경로: {uiContract.helpText}</Text>{sessionMessages.map((item) => <Text key={item} style={styles.settingsValue}>{item}</Text>)}</View>
                <Button accessibilityLabel="로그아웃" title="로그아웃" onPress={() => clearSession("로그아웃되었습니다.")} />
              </View>
            ) : null}

            {activeTab === "home" ? (
              <View style={styles.homeScreen}>
                <View style={styles.homeWelcome}>
                  <Text accessibilityRole="header" style={styles.homeGreeting}>{homeView.greeting}</Text>
                  <Text style={styles.homeDate}>{new Date().toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "short" })}</Text>
                  <Text style={styles.homeStatus}>알림 {notificationSummary?.unreadCount ?? 0}건 · {me.roleName}</Text>
                </View>
                <View style={styles.homeTools}>
                  <TextInput
                    accessibilityLabel="홈 임직원 검색"
                    accessibilityHint="이름, 부서, 역할 또는 이메일로 임직원을 검색합니다."
                    placeholder="임직원 검색"
                    value={employeeSearchQuery}
                    onChangeText={setEmployeeSearchQuery}
                    onSubmitEditing={runEmployeeSearch}
                    style={styles.homeEmployeeSearchInput}
                    returnKeyType="search"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel="임직원 검색 실행" onPress={runEmployeeSearch} style={styles.homeToolButton}>
                    <Text style={styles.homeToolButtonText}>검색</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="AI 채팅 열기" onPress={() => { setActiveTab("more"); setMoreScreen("ai"); setMoreMenuOpen(false); }} style={styles.homeAiButton}>
                    <MoaIcon name="ai" color="#ffffff" size={16} />
                    <Text style={styles.homeToolButtonText}>AI 채팅</Text>
                  </Pressable>
                </View>
                <View style={styles.homeStats}>
                  {homeView.summary.map((item: { id: "mail" | "approval"; label: string; count: number }) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.label} ${item.count}건 화면 열기`}
                      accessibilityHint={`하단 ${item.label === "안 읽은 메일" ? "메일" : "결재"} 화면으로 이동합니다.`}
                      onPress={() => handleTabPress(item.id)}
                      style={styles.homeStatCard}
                    >
                      <Text style={styles.homeStatLabel}>{item.label}</Text>
                      <Text style={styles.homeStatValue}>{item.count}<Text style={styles.homeStatUnit}>건</Text></Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.homeSection}>
                  <View style={styles.homeSectionHeader}><Text style={styles.homeSectionTitle}>오늘의 일정</Text><Text onPress={() => handleTabPress("calendar")} style={styles.homeSectionLink}>전체</Text></View>
                  {homeView.todaySchedules.map((item: WorkspaceSchedule) => (
                    <Pressable key={item.id} onPress={() => handleTabPress("calendar")} style={styles.homeCompactRow}>
                      <Text style={styles.homeRowTime}>{formatStamp(item.starts_at).slice(-5)}</Text>
                      <Text style={styles.homeRowTitle} numberOfLines={1}>{item.title}</Text>
                    </Pressable>
                  ))}
                  {homeView.todaySchedules.length === 0 ? <Text style={styles.homeEmpty}>오늘 등록된 일정이 없습니다.</Text> : null}
                </View>
                <View style={styles.homeSection}>
                    <View style={styles.homeSectionHeader}><Text style={styles.homeSectionTitle}>최근 메신저</Text><Text onPress={() => handleTabPress("chat")} style={styles.homeSectionLink}>더보기</Text></View>
                    {homeView.recentRooms.map((room: MessengerRoom) => (
                      <Pressable key={room.roomId} accessibilityRole="button" accessibilityLabel={`${room.roomName} 대화 열기`} onPress={() => { setActiveTab("chat"); void openRoom(room.roomId); }} style={styles.homeRecentRow}>
                        <Text style={styles.listTitle}>{room.roomName}</Text>
                        <Text style={styles.listBody}>{room.lastMessage || "최근 메시지 없음"}</Text>
                      </Pressable>
                    ))}
                    {homeView.recentRooms.length === 0 ? <Text style={styles.homeEmpty}>최근 대화가 없습니다.</Text> : null}
                </View>
              </View>
            ) : null}

            {activeTab === "mail" ? (
              <View style={styles.mailScreen}>
                <View style={styles.moduleToolbar}>
                  <View><Text style={styles.moduleKicker}>MAIL</Text><Text accessibilityRole="header" style={styles.moduleTitle}>메일</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="새 메일 작성" onPress={() => { setMailComposeOpen(true); setMailError(""); }} style={styles.primaryCompactButton}>
                    <Text style={styles.primaryCompactButtonText}>＋ 새 메일</Text>
                  </Pressable>
                </View>
                <View accessibilityLabel="메일함" style={[styles.mailboxTabs, styles.mailboxTabsCompact]}>
                  {([
                    { id: "inbox", label: "받은메일함" },
                    { id: "starred", label: "중요" },
                    { id: "sent", label: "보낸메일함" },
                    { id: "drafts", label: "임시보관함" },
                  ] as Array<{ id: MailboxTab; label: string }>).map((item) => (
                    <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} 열기`} onPress={() => selectMailbox(item.id)} style={[styles.mailboxTab, mailboxTab === item.id ? styles.mailboxTabActive : null]}>
                      <Text style={[styles.mailboxTabText, mailboxTab === item.id ? styles.mailboxTabTextActive : null]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {mailComposeOpen ? (
                  <View accessibilityLabel="새 메일 작성 양식" style={styles.composeCard}>
                    <View style={styles.composeHeader}><Text style={styles.composeTitle}>새 메일</Text><Text onPress={() => { if (!mailSendPending) setMailComposeOpen(false); }} style={styles.composeClose}>닫기</Text></View>
                    <TextInput accessibilityLabel="메일 수신자" style={styles.compactInput} value={mailComposeForm.to} onChangeText={(to) => setMailComposeForm((current) => ({ ...current, to }))} placeholder="받는 사람 이메일" autoCapitalize="none" keyboardType="email-address" editable={!mailSendPending} />
                    <TextInput accessibilityLabel="메일 제목" style={styles.compactInput} value={mailComposeForm.subject} onChangeText={(subject) => setMailComposeForm((current) => ({ ...current, subject }))} placeholder="제목" editable={!mailSendPending} />
                    <TextInput accessibilityLabel="메일 본문" style={[styles.compactInput, styles.composeBody]} value={mailComposeForm.bodyText} onChangeText={(bodyText) => setMailComposeForm((current) => ({ ...current, bodyText }))} placeholder="내용을 입력하세요" multiline textAlignVertical="top" editable={!mailSendPending} />
                    <Pressable accessibilityRole="button" accessibilityLabel="메일 발송 확인" disabled={mailSendPending} onPress={confirmSendMail} style={[styles.composeSendButton, mailSendPending ? styles.buttonDisabled : null]}>
                      <Text style={styles.composeSendButtonText}>{mailSendPending ? "발송 중" : "발송"}</Text>
                    </Pressable>
                  </View>
                ) : null}
                <TextInput
                  accessibilityLabel="메일 검색"
                  style={styles.mailSearchInput}
                  value={mailQuery}
                  onChangeText={setMailQuery}
                  placeholder="보낸 사람 또는 제목 검색"
                  autoCapitalize="none"
                />
                {(mailboxTab === "inbox" || mailboxTab === "starred") ? <View style={styles.mailFilterRow}>
                  {(["all", "unread"] as const).map((filter) => (
                    <Pressable
                      key={filter}
                      accessibilityRole="button" accessibilityLabel={filter === "all" ? "전체 메일" : "읽지 않은 메일"}
                      onPress={() => setMailFilter(filter)}
                      style={[styles.mailFilterChip, mailFilter === filter ? styles.mailFilterChipActive : null]}
                    >
                      <Text style={mailFilter === filter ? styles.mailFilterTextActive : styles.mailFilterText}>{filter === "all" ? "전체" : "안 읽음"}</Text>
                    </Pressable>
                  ))}
                </View> : null}
                <View accessibilityLabel="메일 목록" style={[styles.mailList, styles.mailListCompact]}>
                  {visibleMailItems.map((item) => {
                    const sender = formatMailSender(item.senderDisplayName, item.senderEmail, mailSenderDisplayMode);
                    return <Pressable
                      key={item.mailId}
                      accessibilityRole="button"
                      accessibilityLabel={`${sender} ${item.subject} 메일 열기`}
                      onPress={() => { void openMail(item.mailId); }}
                      style={[styles.mailRow, styles.mailRowCompact, !item.isRead ? styles.mailRowUnread : null, selectedMailId === item.mailId ? styles.mailRowSelected : null]}
                    >
                      <View style={styles.mailRowMain}>
                        <View style={styles.mailRowTop}>
                          <Text style={[styles.mailSender, !item.isRead ? styles.mailUnreadText : null]} numberOfLines={1}>{sender}</Text>
                          {item.isStarred ? <Text accessibilityLabel="중요 메일" style={styles.mailStar}>★</Text> : null}
                          <Text style={styles.mailDate}>{formatStamp(item.receivedAt || item.sentAt)}</Text>
                        </View>
                        <View style={styles.mailRowBottom}>
                          <Text style={[styles.mailSubject, !item.isRead ? styles.mailUnreadText : null]} numberOfLines={1}>{item.subject || "(제목 없음)"}</Text>
                          <Text style={styles.mailPreview} numberOfLines={1}>{item.preview || item.snippet || "본문 미리보기 없음"}</Text>
                        </View>
                      </View>
                    </Pressable>;
                  })}
                </View>
                {visibleMailItems.length === 0 ? <Text style={styles.emptyState}>조건에 맞는 메일이 없습니다.</Text> : null}
                {selectedMailDetail && mailDetailExpanded ? (
                  <View style={styles.mailDetailCard}>
                    <View style={styles.mailDetailHeader}><Text style={styles.mailDetailKicker}>메일 상세</Text><Pressable accessibilityRole="button" accessibilityLabel="메일 상세 닫기" onPress={() => setMailDetailExpanded(false)}><Text style={styles.mailDetailAction}>닫기</Text></Pressable>{mailboxTab === "inbox" || mailboxTab === "starred" ? <Text accessibilityRole="button" accessibilityLabel="중요 표시 전환" onPress={() => { void toggleMailStarState(selectedMailDetail.mailId); }} style={styles.mailDetailAction}>★ 중요</Text> : null}</View>
                    <Text style={styles.mailDetailTitle}>{selectedMailDetail.subject}</Text>
                    <Text style={styles.mailDetailMeta}>{formatMailSender(selectedMailDetail.senderDisplayName, selectedMailDetail.senderEmail, mailSenderDisplayMode)} · {formatStamp(selectedMailDetail.sentAt || selectedMailDetail.createdAt)}</Text>
                    <Text style={styles.mailDetailBody}>{selectedMailDetail.bodyText}</Text>
                    <Text style={styles.mailDetailMeta}>수신: {selectedMailDetail.recipients.map((item) => item.recipientEmail).join(", ") || "-"}</Text>
                  </View>
                ) : null}
                {mailError ? <Text style={styles.error}>{mailError}</Text> : null}
                <Text style={styles.mailPolicyNote}>장기 보관 메일은 설치형 로컬 아카이브에서 관리됩니다.</Text>
              </View>
            ) : null}

            {activeTab === "approval" ? (
              <View style={[styles.approvalScreen, styles.approvalScreenFlat]}>
                <View style={styles.moduleToolbar}>
                  <View><Text style={styles.moduleKicker}>APPROVAL</Text><Text accessibilityRole="header" style={styles.moduleTitle}>결재</Text></View>
                  {can("approval:create") ? <Text accessibilityRole="button" accessibilityLabel="결재 초안 작성" onPress={() => setApprovalComposeOpen((current) => !current)} style={styles.approvalCreateAction}>{approvalComposeOpen ? "닫기" : "＋ 기안"}</Text> : null}
                </View>
                <View accessibilityLabel="결재 상태" style={[styles.approvalTabs, styles.approvalTabsCompact]}>
                  {(["draft", "progress", "complete"] as ApprovalView[]).map((view, index) => (
                    <Pressable key={view} accessibilityRole="button" accessibilityLabel={`${approvalScreen.tabs[index]} 결재 보기`} onPress={() => { setApprovalView(view); setSelectedApprovalId(""); }} style={[styles.approvalTab, approvalView === view ? styles.approvalTabActive : null]}>
                      <Text style={[styles.approvalTabText, approvalView === view ? styles.approvalTabTextActive : null]}>{approvalScreen.tabs[index]}{view === "progress" ? ` ${approvalScreen.rows.length}` : ""}</Text>
                    </Pressable>
                  ))}
                </View>
                {approvalComposeOpen ? (
                  <View style={styles.approvalComposeCard}>
                    <TextInput accessibilityLabel="결재 제목" style={styles.compactInput} value={createForm.title} onChangeText={(title) => setCreateForm((current) => ({ ...current, title }))} placeholder="제목" />
                    <TextInput accessibilityLabel="결재 내용" style={[styles.compactInput, styles.composeBody]} value={createForm.content} onChangeText={(content) => setCreateForm((current) => ({ ...current, content }))} placeholder="내용" multiline textAlignVertical="top" />
                    <TextInput accessibilityLabel="결재자 사용자 아이디" style={styles.compactInput} value={createForm.approverUserIds} onChangeText={(approverUserIds) => setCreateForm((current) => ({ ...current, approverUserIds }))} placeholder="결재자 사용자ID (콤마 구분)" autoCapitalize="none" />
                    <Pressable accessibilityRole="button" accessibilityLabel="결재 초안 저장" onPress={() => { void createApprovalDocument(); }} style={styles.composeSendButton}><Text style={styles.composeSendButtonText}>초안 저장</Text></Pressable>
                  </View>
                ) : null}
                {approvalScreen.rows.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.approvalDocumentStrip}>
                  {approvalScreen.rows.map((doc) => <Pressable key={doc.id} accessibilityRole="button" accessibilityLabel={`${doc.title} 결재 선택`} onPress={() => setSelectedApprovalId(doc.id)} style={[styles.approvalDocumentChip, selectedApproval?.id === doc.id ? styles.approvalDocumentChipActive : null]}><Text numberOfLines={1} style={styles.approvalDocumentChipText}>{doc.title}</Text></Pressable>)}
                </ScrollView> : null}
                {!selectedApproval ? <Text style={styles.emptyState}>해당 상태의 결재 문서가 없습니다.</Text> : (
                  <View style={styles.approvalDetailCard}>
                    <Text style={styles.approvalSectionLabel}>기안 문서</Text>
                    <Text style={styles.approvalDetailTitle}>{selectedApproval.title}</Text>
                    <View style={styles.approvalMetaGrid}>
                      <Text style={styles.approvalMetaLabel}>기안자</Text><Text style={styles.approvalMetaValue}>{selectedApproval.creatorUserName}</Text>
                      <Text style={styles.approvalMetaLabel}>상태</Text><Text style={styles.approvalMetaValue}>{selectedApproval.status}</Text>
                    </View>
                    <View style={styles.approvalDivider} />
                    <Text style={styles.approvalSectionLabel}>상세 내용</Text>
                    <Text style={styles.approvalDetailBody}>{selectedApproval.content || "내용이 없습니다."}</Text>
                    <View style={styles.approvalDivider} />
                    <Text style={styles.approvalSectionLabel}>결재선</Text>
                    {(selectedApproval.lines ?? []).map((line, index) => <View key={`${line.sequence}-${line.approverUserId}`} style={styles.approvalLine}><Text style={styles.approvalLineStep}>{index + 1}</Text><Text style={styles.approvalLineName}>{line.approverUserName}</Text><Text style={styles.approvalLineStatus}>{line.status}</Text></View>)}
                    {(selectedApproval.lines ?? []).length === 0 ? <Text style={styles.approvalDetailMeta}>등록된 결재선이 없습니다.</Text> : null}
                    {selectedApproval.status === "submitted" && can("approval:act") && currentApprover(selectedApproval)?.approverUserId === me?.userId ? <TextInput accessibilityLabel="결재 처리 사유" style={styles.compactInput} value={actionReason} onChangeText={setActionReason} placeholder="처리 사유" /> : null}
                    <View style={styles.approvalActions}>
                      {selectedApproval.status === "draft" && selectedApproval.creatorUserId === me?.userId && can("approval:submit") ? <Pressable accessibilityRole="button" accessibilityLabel="결재 상신" onPress={() => { void action(selectedApproval.id, "submit"); }} style={styles.approvalPrimaryAction}><Text style={styles.approvalPrimaryActionText}>상신</Text></Pressable> : null}
                      {selectedApproval.status === "submitted" && selectedApproval.creatorUserId === me?.userId && can("approval:withdraw") ? <Pressable accessibilityRole="button" accessibilityLabel="결재 회수" onPress={() => { void action(selectedApproval.id, "withdraw"); }} style={styles.approvalRejectAction}><Text style={styles.approvalRejectActionText}>회수</Text></Pressable> : null}
                      {selectedApproval.status === "rejected" && selectedApproval.creatorUserId === me?.userId && can("approval:rework") ? <Pressable accessibilityRole="button" accessibilityLabel="결재 재기안" onPress={() => { void action(selectedApproval.id, "redraft"); }} style={styles.approvalPrimaryAction}><Text style={styles.approvalPrimaryActionText}>재기안</Text></Pressable> : null}
                      {selectedApproval.status === "submitted" && can("approval:act") && currentApprover(selectedApproval)?.approverUserId === me?.userId ? <><Pressable accessibilityRole="button" accessibilityLabel="결재 반려" onPress={() => { void actionWithReason(selectedApproval.id, "reject"); }} style={styles.approvalRejectAction}><Text style={styles.approvalRejectActionText}>반려</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="결재 승인" onPress={() => { void actionWithReason(selectedApproval.id, "approve"); }} style={styles.approvalPrimaryAction}><Text style={styles.approvalPrimaryActionText}>승인</Text></Pressable></> : null}
                    </View>
                  </View>
                )}
              </View>
            ) : null}

            {activeTab === "chat" ? (
              <View style={[styles.messengerScreen, styles.messengerScreenFlat]}>
                <View style={styles.messengerHeader}>
                  <View style={styles.messengerAvatar}><Text style={styles.messengerAvatarText}>{messengerScreen.selectedRoom?.roomName?.slice(0, 1) || "M"}</Text></View>
                  <View style={styles.messengerHeaderText}><Text accessibilityRole="header" style={styles.messengerRoomTitle}>{messengerScreen.selectedRoom?.roomName || "메신저"}</Text><Text style={styles.messengerRoomMeta}>{messengerScreen.selectedRoom ? `참여자 ${messengerScreen.selectedRoom.participantIds.length}명` : "대화방을 선택해 주세요"}</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="새 대화 시작" onPress={openRoomComposer} style={styles.roomCreateIconButton}><Text style={styles.messengerHeaderIcon}>＋</Text></Pressable><Text style={styles.messengerHeaderIcon}>⌕</Text>
                </View>
                {rooms.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.messengerRoomStrip}>{rooms.map((room) => <Pressable key={room.roomId} accessibilityRole="button" accessibilityLabel={`${room.roomName} 대화방 열기`} onPress={() => { void openRoom(room.roomId); }} style={[styles.messengerRoomChip, messengerScreen.selectedRoom?.roomId === room.roomId ? styles.messengerRoomChipActive : null]}><Text style={styles.messengerRoomChipText}>{room.roomName}</Text>{room.unreadCount > 0 ? <Text style={styles.messengerUnreadBadge}>{room.unreadCount}</Text> : null}</Pressable>)}</ScrollView> : null}
                {!messengerScreen.selectedRoom ? <View style={styles.messengerEmpty}><Text style={styles.messengerEmptyTitle}>참여 중인 대화방이 없습니다.</Text><Pressable accessibilityRole="button" accessibilityLabel="새 대화 시작" onPress={openRoomComposer} style={styles.primaryCompactButton}><Text style={styles.primaryCompactButtonText}>새 대화</Text></Pressable></View> : <>
                  <View accessibilityLabel="메시지 목록" style={styles.messageCanvas}>
                    {messengerScreen.messages.map((item) => {
                      const mine = item.senderUserId === me?.userId;
                      return <View key={item.messageId} style={[styles.messageGroup, mine ? styles.messageGroupMine : null]}>{!mine ? <Text style={styles.messageSender}>{item.senderUserName}</Text> : null}<View style={[styles.messageBubble, mine ? styles.messageBubbleMine : styles.messageBubbleOther]}><Text style={mine ? styles.messageTextMine : styles.messageTextOther}>{item.body}</Text></View><Text style={styles.messageTime}>{formatStamp(item.createdAt).slice(-5)}</Text></View>;
                    })}
                    {messengerScreen.messages.length === 0 ? <Text style={styles.messengerEmptyMessages}>아직 메시지가 없습니다.</Text> : null}
                  </View>
                  <View accessibilityLabel="대화 번역 언어" style={[styles.translationControl, styles.messengerLanguageSwitcher]}>
                    <Pressable accessibilityRole="button" accessibilityLabel="한국어 번역 선택" disabled={chatTranslationPending} onPress={() => { void updateRoomTranslation("ko"); }} style={styles.translationOption}><Text style={[styles.translationOptionText, messengerScreen.selectedRoom?.translationLocale === "ko" ? styles.translationOptionTextActive : null]}>한국어</Text></Pressable>
                    <Text style={styles.translationSwap}>↔</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="English 번역 선택" disabled={chatTranslationPending} onPress={() => { void updateRoomTranslation("en"); }} style={styles.translationOption}><Text style={[styles.translationOptionText, messengerScreen.selectedRoom?.translationLocale === "en" ? styles.translationOptionTextActive : null]}>English</Text></Pressable>
                  </View>
                  <View style={styles.messengerInputBar}>
                    <TextInput accessibilityLabel="메신저 메시지" style={styles.messengerInput} value={chatDraft} onChangeText={setChatDraft} placeholder="메시지를 입력하세요." returnKeyType="send" onSubmitEditing={() => { void sendChatMessage(); }} />
                    <Pressable accessibilityRole="button" accessibilityLabel="메시지 전송" onPress={() => { void sendChatMessage(); }} style={styles.messengerSendButton}><Text style={styles.messengerSendText}>➤</Text></Pressable>
                  </View>
                </>}
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

          </>
        ) : null}
      </ScrollView>
      <Modal visible={roomCreateOpen} transparent animationType="slide" onRequestClose={() => { if (!roomCreateGateRef.current) setRoomCreateOpen(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.roomCreateBackdrop}>
          <View accessibilityViewIsModal style={styles.roomCreateModal}>
            <View style={styles.employeeSearchModalHeader}>
              <Text accessibilityRole="header" style={styles.employeeSearchModalTitle}>새 대화</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="새 대화 닫기" disabled={roomCreatePending} onPress={() => setRoomCreateOpen(false)} style={styles.roomCreateIconButton}>
                <Text style={styles.employeeSearchClose}>닫기</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.roomCreateContent}>
              <View style={styles.roomCreateTypes}>
                {([ ["direct", "1:1 대화"], ["group", "그룹 대화"] ] as const).map(([roomType, label]) => (
                  <Pressable key={roomType} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: roomCreateForm.roomType === roomType, disabled: roomCreatePending }} disabled={roomCreatePending}
                    onPress={() => { setRoomCreateError(""); setRoomCreateForm((current) => ({ ...current, roomType, participantUserIds: roomType === "direct" ? current.participantUserIds.slice(0, 1) : current.participantUserIds })); }}
                    style={[styles.roomCreateType, roomCreateForm.roomType === roomType ? styles.roomCreateTypeSelected : null]}>
                    <Text style={styles.roomCreateLabel}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {roomCreateForm.roomType === "group" ? <>
                <Text style={styles.roomCreateLabel}>대화방 이름</Text>
                <TextInput accessibilityLabel="그룹 대화방 이름" placeholder="대화방 이름 (최대 80자)" editable={!roomCreatePending} value={roomCreateForm.roomName} onChangeText={(roomName) => setRoomCreateForm((current) => ({ ...current, roomName }))} style={styles.input} />
              </> : null}
              <Text style={styles.roomCreateLabel}>참여자 선택 · 본인 포함 {roomCreateForm.participantUserIds.length + 1}명</Text>
              <Text style={styles.roomCreateMeta}>{roomCreateForm.roomType === "direct" ? "대화 상대 한 명을 선택하세요." : "같은 회사의 참여자를 선택하세요. 본인 포함 최대 100명입니다."}</Text>
              <TextInput accessibilityLabel="대화 참여자 검색" placeholder="이름·부서·이메일 검색" editable={!roomCreatePending} value={roomCreateQuery} onChangeText={setRoomCreateQuery} style={styles.input} />
              {roomCreateForm.participantUserIds.length > 0 ? <View style={styles.roomCreateSelections}>
                {directoryUsers.filter((member) => roomCreateForm.participantUserIds.includes(member.id)).map((member) => (
                  <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`${member.name} 선택 해제`} disabled={roomCreatePending} style={styles.roomCreateSelection} onPress={() => setRoomCreateForm((current) => ({ ...current, participantUserIds: current.participantUserIds.filter((id) => id !== member.id) }))}>
                    <Text style={styles.roomCreateLabel}>{member.name} ×</Text>
                  </Pressable>
                ))}
              </View> : null}
              {roomDirectoryLoading ? <Text style={styles.roomCreateMeta}>참여자를 불러오는 중입니다.</Text> : roomDirectoryError ? <Text accessibilityRole="alert" style={styles.error}>{roomDirectoryError}</Text> : null}
              {!roomDirectoryLoading && !roomDirectoryError && filterDirectoryUsers(directoryUsers, roomCreateQuery).filter((member: DirectoryUser) => member.id !== me?.userId).length === 0 ? <Text style={styles.roomCreateMeta}>선택할 참여자가 없습니다.</Text> : null}
              {!roomDirectoryLoading && !roomDirectoryError ? filterDirectoryUsers(directoryUsers, roomCreateQuery).filter((member: DirectoryUser) => member.id !== me?.userId).map((member: DirectoryUser) => {
                const selected = roomCreateForm.participantUserIds.includes(member.id);
                const disabled = roomCreatePending || (roomCreateForm.roomType === "group" && !selected && roomCreateForm.participantUserIds.length >= 99);
                return <Pressable key={member.id} accessibilityRole={roomCreateForm.roomType === "group" ? "checkbox" : "radio"} accessibilityLabel={`${member.name} 참여자`} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={() => toggleRoomParticipant(member.id)} style={[styles.roomCreateParticipant, selected ? styles.roomCreateTypeSelected : null]}>
                  <View style={styles.roomCreateMemberInfo}><Text style={styles.employeeSearchName}>{member.name}</Text><Text style={styles.employeeSearchMeta}>{member.department_name} · {member.email}</Text></View>
                  <Text style={styles.roomCreateLabel}>{selected ? "선택됨" : "선택"}</Text>
                </Pressable>;
              }) : null}
              {roomCreateError ? <Text accessibilityRole="alert" style={styles.error}>{roomCreateError}</Text> : null}
            </ScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel="대화방 생성" accessibilityState={{ disabled: roomCreatePending || roomDirectoryLoading || Boolean(roomDirectoryError) }} disabled={roomCreatePending || roomDirectoryLoading || Boolean(roomDirectoryError)} onPress={() => void submitRoomCreate()} style={[styles.primaryCompactButton, styles.roomCreateSubmit, roomCreatePending || roomDirectoryLoading || roomDirectoryError ? styles.roomCreateDisabled : null]}>
              <Text style={styles.primaryCompactButtonText}>{roomCreatePending ? "생성 중…" : "대화방 생성"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={employeeSearchOpen} transparent animationType="fade" onRequestClose={() => setEmployeeSearchOpen(false)}>
        <View style={styles.employeeSearchBackdrop}>
          <View accessibilityViewIsModal style={styles.employeeSearchModal}>
            <View style={styles.employeeSearchModalHeader}>
              <Text accessibilityRole="header" style={styles.employeeSearchModalTitle}>임직원 검색 결과</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="임직원 검색 결과 닫기" onPress={() => setEmployeeSearchOpen(false)}>
                <Text style={styles.employeeSearchClose}>닫기</Text>
              </Pressable>
            </View>
            {employeeSearchResults.length === 0 ? <Text style={styles.employeeSearchEmpty}>검색 결과가 없습니다.</Text> : employeeSearchResults.map((member) => (
              <View key={member.id} style={styles.employeeSearchResult}>
                <Text style={styles.employeeSearchName}>{member.name}</Text>
                <Text style={styles.employeeSearchMeta}>{member.department_name} · {member.role_name}</Text>
                <Text style={styles.employeeSearchEmail}>{member.email}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
      {me ? (
        <View style={styles.mobileBottomNav}>
          {mobileNavigation.bottom.map((item: { id: string; label: string; icon: IconName }) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} 메뉴`} accessibilityHint="선택한 업무 탭으로 이동합니다." onPress={() => handleTabPress(item.id as MobileTab)} style={[styles.mobileBottomNavItem, activeTab === item.id ? styles.mobileBottomNavItemActive : null]}>
              <MoaIcon name={item.icon as IconName} color={activeTab === item.id ? "#ffffff" : "#475569"} size={18} />
              <Text style={[styles.mobileBottomNavLabel, activeTab === item.id ? styles.mobileBottomNavLabelActive : null]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create(withMobileTypography({
  settingsBackButton: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingRight: 12, gap: 4 },
  backGlyph: { fontSize: 28, color: "#ffffff" },
  settingsBackText: { fontSize: 14, fontWeight: "600", color: "#ffffff" },
  roomCreateBackdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(15,23,42,0.45)" },
  roomCreateModal: { maxHeight: "90%", flexShrink: 1, padding: 16, borderRadius: 20, backgroundColor: "#ffffff" },
  roomCreateContent: { gap: 12, paddingBottom: 12 },
  roomCreateTypes: { flexDirection: "row", gap: 8 },
  roomCreateType: { flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12 },
  roomCreateTypeSelected: { backgroundColor: "#ccfbf1", borderColor: "#0f766e" },
  roomCreateLabel: { color: "#0f172a", fontSize: 14, fontWeight: "600" },
  roomCreateMeta: { color: "#475569", fontSize: 12 },
  roomCreateIconButton: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  roomCreateSelections: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roomCreateSelection: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#ccfbf1" },
  roomCreateParticipant: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 60, padding: 10, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12 },
  roomCreateMemberInfo: { flex: 1 },
  roomCreateSubmit: { minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: 12 },
  roomCreateDisabled: { opacity: 0.5 },
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
  homeScreen: {
    gap: 10,
  },
  homeWelcome: {
    backgroundColor: "#07305a",
    borderRadius: 14,
    padding: 16,
  },
  homeGreeting: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  homeDate: {
    marginTop: 4,
    color: "#dbeafe",
    fontSize: 11,
  },
  homeStatus: {
    marginTop: 8,
    color: "#bae6fd",
    fontSize: 10,
  },
  homeStats: {
    flexDirection: "row",
    gap: 10,
  },
  homeStatCard: {
    flex: 1,
    minHeight: 84,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  homeStatLabel: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "700",
  },
  homeStatValue: {
    marginTop: 8,
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "800",
  },
  homeStatUnit: {
    color: "#64748b",
    fontSize: 10,
  },
  homeSection: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe4ec",
    padding: 12,
  },
  homeSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  homeSectionTitle: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "800",
  },
  homeSectionLink: {
    color: "#0f766e",
    fontSize: 10,
    fontWeight: "700",
  },
  homeCompactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#eef2f7",
  },
  homeRowTime: {
    width: 42,
    color: "#0f766e",
    fontSize: 10,
    fontWeight: "800",
  },
  homeRowTitle: {
    flex: 1,
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "700",
  },
  homeEmpty: {
    color: "#64748b",
    fontSize: 10,
    paddingVertical: 10,
  },
  homeTools: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  homeEmployeeSearchInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    fontSize: 11,
  },
  homeToolButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
  },
  homeAiButton: {
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#334155",
  },
  homeToolButtonText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
  employeeSearchBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  employeeSearchModal: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    borderRadius: 16,
    padding: 16,
    backgroundColor: "#ffffff",
  },
  employeeSearchModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  employeeSearchModalTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800",
  },
  employeeSearchClose: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
  },
  employeeSearchResult: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  employeeSearchName: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  employeeSearchMeta: {
    marginTop: 3,
    color: "#475569",
    fontSize: 10,
  },
  employeeSearchEmail: {
    marginTop: 2,
    color: "#0f766e",
    fontSize: 10,
  },
  employeeSearchEmpty: {
    color: "#64748b",
    fontSize: 11,
    paddingVertical: 20,
    textAlign: "center",
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
  mailScreen: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    padding: 0,
  },
  moduleToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moduleKicker: {
    color: "#0f766e",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  moduleTitle: {
    marginTop: 2,
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
  },
  primaryCompactButton: {
    borderRadius: 10,
    backgroundColor: "#0f766e",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryCompactButtonText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  mailboxTabs: {
    marginTop: 12,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#dbe4ec",
  },
  mailboxTabsCompact: {
    marginTop: 8,
    minHeight: 30,
  },
  mailboxTab: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    paddingHorizontal: 2,
  },
  mailboxTabActive: {
    borderBottomColor: "#0f766e",
  },
  mailboxTabText: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
  },
  mailboxTabTextActive: {
    color: "#0f766e",
    fontWeight: "800",
  },
  composeCard: {
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  composeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  composeTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  composeClose: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
  },
  compactInput: {
    marginTop: 8,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#0f172a",
    fontSize: 12,
  },
  composeBody: {
    minHeight: 92,
  },
  composeSendButton: {
    marginTop: 10,
    alignSelf: "flex-end",
    borderRadius: 9,
    backgroundColor: "#0f766e",
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  composeSendButtonText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  mailSearchInput: {
    marginTop: 12,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 11,
    paddingVertical: 7,
    color: "#0f172a",
    fontSize: 11,
  },
  mailFilterRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 6,
  },
  mailFilterChip: {
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mailFilterChipActive: {
    backgroundColor: "#ccfbf1",
  },
  mailFilterText: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
  },
  mailFilterTextActive: {
    color: "#0f766e",
    fontSize: 9,
    fontWeight: "800",
  },
  mailList: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#dbe4ec",
  },
  mailListCompact: {
    marginTop: 6,
  },
  mailRow: {
    minHeight: 58,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  mailRowCompact: {
    minHeight: 48,
    paddingVertical: 5,
    paddingHorizontal: 6,
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
  mailDetailCard: {
    marginTop: 8,
    borderRadius: 8,
    padding: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
    gap: 7,
  },
  mailDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mailDetailKicker: {
    color: "#0f766e",
    fontSize: 9,
    fontWeight: "800",
  },
  mailDetailAction: {
    color: "#b45309",
    fontSize: 10,
    fontWeight: "800",
  },
  mailDetailTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  mailDetailMeta: {
    color: "#64748b",
    fontSize: 9,
  },
  mailDetailBody: {
    color: "#334155",
    fontSize: 11,
    lineHeight: 17,
  },
  mailPolicyNote: {
    marginTop: 10,
    color: "#94a3b8",
    fontSize: 9,
  },
  approvalScreen: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dce5ec",
    padding: 14,
  },
  approvalScreenFlat: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    padding: 0,
  },
  approvalCreateAction: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "800",
  },
  approvalTabs: {
    marginTop: 12,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#dbe4ec",
  },
  approvalTabsCompact: {
    marginTop: 8,
    minHeight: 32,
  },
  approvalTab: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  approvalTabActive: {
    borderBottomColor: "#0f766e",
  },
  approvalTabText: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
  },
  approvalTabTextActive: {
    color: "#0f766e",
    fontWeight: "800",
  },
  approvalComposeCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  approvalDocumentStrip: {
    gap: 6,
    paddingTop: 10,
  },
  approvalDocumentChip: {
    maxWidth: 150,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#f1f5f9",
  },
  approvalDocumentChipActive: {
    backgroundColor: "#ccfbf1",
  },
  approvalDocumentChipText: {
    color: "#334155",
    fontSize: 9,
    fontWeight: "700",
  },
  approvalDetailCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe4ec",
    backgroundColor: "#ffffff",
    padding: 12,
  },
  approvalSectionLabel: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "800",
  },
  approvalDetailTitle: {
    marginTop: 7,
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
  },
  approvalMetaGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 5,
  },
  approvalMetaLabel: {
    width: "22%",
    color: "#64748b",
    fontSize: 9,
  },
  approvalMetaValue: {
    width: "78%",
    color: "#334155",
    fontSize: 10,
    fontWeight: "700",
  },
  approvalDivider: {
    marginVertical: 10,
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  approvalDetailBody: {
    marginTop: 7,
    color: "#334155",
    fontSize: 11,
    lineHeight: 17,
  },
  approvalDetailMeta: {
    marginTop: 7,
    color: "#64748b",
    fontSize: 9,
  },
  approvalLine: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  approvalLineStep: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ccfbf1",
    color: "#0f766e",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 18,
  },
  approvalLineName: {
    flex: 1,
    color: "#334155",
    fontSize: 10,
    fontWeight: "700",
  },
  approvalLineStatus: {
    color: "#64748b",
    fontSize: 9,
  },
  approvalActions: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  approvalRejectAction: {
    minWidth: 86,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#ef4444",
    paddingVertical: 9,
    alignItems: "center",
  },
  approvalRejectActionText: {
    color: "#dc2626",
    fontSize: 11,
    fontWeight: "800",
  },
  approvalPrimaryAction: {
    minWidth: 86,
    borderRadius: 9,
    backgroundColor: "#0f9f9a",
    paddingVertical: 9,
    alignItems: "center",
  },
  approvalPrimaryActionText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  messengerScreen: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dce5ec",
    overflow: "hidden",
  },
  messengerScreenFlat: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    overflow: "visible",
  },
  messengerHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  messengerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
  },
  messengerAvatarText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  messengerHeaderText: {
    flex: 1,
  },
  messengerRoomTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  messengerRoomMeta: {
    marginTop: 2,
    color: "#64748b",
    fontSize: 9,
  },
  messengerHeaderIcon: {
    color: "#0f172a",
    fontSize: 17,
    fontWeight: "700",
  },
  messengerRoomStrip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 6,
  },
  messengerRoomChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: "#f1f5f9",
  },
  messengerRoomChipActive: {
    backgroundColor: "#ccfbf1",
  },
  messengerRoomChipText: {
    color: "#334155",
    fontSize: 9,
    fontWeight: "700",
  },
  messengerUnreadBadge: {
    minWidth: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: "#ef4444",
    color: "#ffffff",
    fontSize: 8,
    textAlign: "center",
  },
  messengerEmpty: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 20,
  },
  messengerEmptyTitle: {
    color: "#475569",
    fontSize: 11,
  },
  messageCanvas: {
    minHeight: 260,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: "#fbfdff",
    gap: 10,
  },
  messageGroup: {
    alignItems: "flex-start",
  },
  messageGroupMine: {
    alignItems: "flex-end",
  },
  messageSender: {
    marginBottom: 4,
    color: "#475569",
    fontSize: 9,
    fontWeight: "700",
  },
  messageBubble: {
    maxWidth: "78%",
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  messageBubbleMine: {
    borderBottomRightRadius: 3,
    backgroundColor: "#0f9f9a",
  },
  messageBubbleOther: {
    borderBottomLeftRadius: 3,
    backgroundColor: "#eef2f7",
  },
  messageTextMine: {
    color: "#ffffff",
    fontSize: 11,
    lineHeight: 16,
  },
  messageTextOther: {
    color: "#334155",
    fontSize: 11,
    lineHeight: 16,
  },
  messageTime: {
    marginTop: 3,
    color: "#94a3b8",
    fontSize: 8,
  },
  messengerEmptyMessages: {
    color: "#94a3b8",
    fontSize: 10,
    textAlign: "center",
    paddingVertical: 60,
  },
  translationControl: {
    marginHorizontal: 12,
    marginVertical: 9,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#0f9f9a",
  },
  messengerLanguageSwitcher: {
    marginHorizontal: 12,
  },
  translationOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
  },
  translationOptionText: {
    color: "#475569",
    fontSize: 10,
  },
  translationOptionTextActive: {
    color: "#0f766e",
    fontWeight: "800",
  },
  translationSwap: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
  },
  messengerInputBar: {
    marginHorizontal: 12,
    marginBottom: 12,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dbe4ec",
    backgroundColor: "#ffffff",
  },
  messengerInput: {
    flex: 1,
    paddingHorizontal: 11,
    color: "#0f172a",
    fontSize: 11,
  },
  messengerSendButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  messengerSendText: {
    color: "#0f766e",
    fontSize: 16,
    fontWeight: "800",
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
  directoryScreen: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dce5ec",
    padding: 12,
  },
  directoryScreenFlat: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 0,
    padding: 0,
  },
  directoryScreenTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
  },
  directorySearchInput: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#dbe4ec",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 11,
    color: "#0f172a",
    fontSize: 10,
  },
  directorySections: {
    marginTop: 8,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  directorySection: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  directorySectionActive: {
    borderBottomColor: "#0f9f9a",
  },
  directorySectionText: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
  },
  directorySectionTextActive: {
    color: "#0f766e",
    fontWeight: "800",
  },
  directoryListHeader: {
    paddingVertical: 11,
  },
  directoryListTitle: {
    color: "#334155",
    fontSize: 10,
    fontWeight: "800",
  },
  directoryCompactRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7",
    paddingVertical: 7,
  },
  directoryInitial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e2e8f0",
  },
  directoryInitialText: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "800",
  },
  directoryCompactInfo: {
    flex: 1,
  },
  directoryMemberName: {
    color: "#0f172a",
    fontSize: 11,
    fontWeight: "800",
  },
  directoryMemberRole: {
    color: "#475569",
    fontSize: 9,
    fontWeight: "600",
  },
  directoryDepartment: {
    marginTop: 3,
    color: "#64748b",
    fontSize: 9,
  },
  directoryIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  directoryIconDisabled: {
    opacity: 0.35,
  },
  directoryIcon: {
    color: "#0f82a0",
    fontSize: 14,
    fontWeight: "800",
  },
  directoryCard: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
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
  directoryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    maxWidth: "100%",
  },
  directoryError: { color: "#9f1239", marginTop: 8, fontSize: 12 },
  calendarScreen: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dce5ec",
    padding: 14,
  },
  calendarToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 38,
  },
  calendarArrow: {
    width: 28,
    color: "#334155",
    fontSize: 22,
    textAlign: "center",
  },
  calendarMonthTitle: {
    flex: 1,
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  calendarTodayButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbe4ec",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  calendarTodayText: {
    color: "#475569",
    fontSize: 9,
    fontWeight: "700",
  },
  calendarWeekdays: {
    marginTop: 8,
    flexDirection: "row",
  },
  calendarWeekday: {
    width: "14.285%",
    color: "#475569",
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
  },
  calendarSunday: {
    color: "#ef4444",
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
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarCompactCell: {
    width: "14.285%",
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarCompactDate: {
    width: 24,
    height: 24,
    borderRadius: 12,
    color: "#334155",
    fontSize: 10,
    lineHeight: 24,
    textAlign: "center",
  },
  calendarSelectedDate: {
    backgroundColor: "#0f9f9a",
    color: "#ffffff",
    fontWeight: "800",
  },
  calendarEventDot: {
    marginTop: 2,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#0f9f9a",
  },
  selectedDayHeader: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  selectedDayTitle: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "800",
  },
  selectedDayCount: {
    color: "#64748b",
    fontSize: 9,
  },
  selectedScheduleList: {
    marginTop: 7,
  },
  selectedScheduleRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-start",
    borderLeftWidth: 2,
    borderLeftColor: "#0f9f9a",
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7",
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  selectedScheduleAlert: {
    borderLeftColor: "#ef4444",
  },
  selectedScheduleTime: {
    width: 46,
    color: "#0f172a",
    fontSize: 10,
    fontWeight: "800",
  },
  selectedScheduleBody: {
    flex: 1,
  },
  selectedScheduleTitle: {
    color: "#334155",
    fontSize: 10,
    fontWeight: "800",
  },
  selectedScheduleMeta: {
    marginTop: 3,
    color: "#64748b",
    fontSize: 8,
  },
  calendarEmpty: {
    color: "#94a3b8",
    fontSize: 10,
    paddingVertical: 16,
    textAlign: "center",
  },
  scheduleComposeCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  calendarCreateButton: {
    marginTop: 12,
    alignSelf: "flex-end",
    borderRadius: 999,
    backgroundColor: "#0f9f9a",
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  calendarCreateText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
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
  aiScreen: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dce5ec",
    overflow: "hidden",
  },
  aiHeader: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  aiTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
  },
  aiProviderStatus: {
    marginTop: 2,
    color: "#64748b",
    fontSize: 8,
  },
  aiSettingsAction: {
    color: "#0f766e",
    fontSize: 10,
    fontWeight: "800",
  },
  aiConversation: {
    minHeight: 280,
    gap: 10,
    padding: 12,
    backgroundColor: "#fbfdff",
  },
  aiMessageGroup: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  aiMessageGroupUser: {
    justifyContent: "flex-end",
  },
  aiAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f82c9",
  },
  aiAvatarText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "800",
  },
  aiMessageBubble: {
    maxWidth: "80%",
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  aiMessageAssistant: {
    borderTopLeftRadius: 3,
    backgroundColor: "#eef2f7",
  },
  aiMessageUser: {
    borderTopRightRadius: 3,
    backgroundColor: "#0f9f9a",
  },
  aiMessageTextAssistant: {
    color: "#334155",
    fontSize: 10,
    lineHeight: 15,
  },
  aiMessageTextUser: {
    color: "#ffffff",
    fontSize: 10,
    lineHeight: 15,
  },
  aiInputBar: {
    margin: 10,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#dbe4ec",
  },
  aiAddButton: {
    width: 36,
    color: "#475569",
    fontSize: 18,
    textAlign: "center",
  },
  aiInput: {
    flex: 1,
    color: "#0f172a",
    fontSize: 10,
    paddingVertical: 8,
  },
  aiSendButton: {
    width: 34,
    height: 34,
    marginRight: 4,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#083b73",
  },
  aiSendText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  aiReadinessNote: {
    marginHorizontal: 12,
    marginBottom: 10,
    color: "#64748b",
    fontSize: 9,
  },
  aiInlineError: {
    marginHorizontal: 12,
    marginBottom: 12,
    color: "#b91c1c",
    fontSize: 10,
    lineHeight: 15,
  },
  settingsCompactSection: {
    marginVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 9,
  },
  settingsNotificationRow: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    padding: 9,
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
}));
