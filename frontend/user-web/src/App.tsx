import { FormEvent, useEffect, useMemo, useState, useRef } from "react";

import {
  apiBase,
  ackNotification,
  fetchMe,
  approveApproval,
  fetchNotificationSummary,
  clearUserToken,
  createApproval,
  fetchApprovals,
  fetchNotifications,
  fetchApprovalLogs,
  getUserToken,
  fetchTranslationStatus,
  type NotificationRecord,
  type NotificationSummary,
  login,
  redraftApproval,
  rejectApproval,
  storeUserToken,
  submitApproval,
  withdrawApproval,
  requestTranslation,
  type ApprovalDocument,
  type AuthUser,
  type LoginResponse,
  type TranslationItem,
  type TranslationRequest,
  type TranslationResponse,
} from "./api";
import { resolveLocale, supportedLocales, supportedTimezones, t, tf, type AppLocale } from "./i18n";

const NOTIFICATION_POLICY = {
  retryMaxAttempts: 3,
  retryDelayMs: 400,
  streamRetryMax: 2,
  streamReconnectDelayMs: 600,
} as const;

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

const userCopy: Record<AppLocale, Record<string, string>> = {
  "ko-KR": {
    approvalListTitle: "결재 목록",
    noDocuments: "문서가 없습니다.",
  },
  "en-US": {
    approvalListTitle: "Approval List",
    noDocuments: "No documents.",
  },
  "ja-JP": {
    approvalListTitle: "承認一覧",
    noDocuments: "文書がありません。",
  },
  "zh-CN": {
    approvalListTitle: "审批列表",
    noDocuments: "暂无文档。",
  },
  "es-ES": {
    approvalListTitle: "Lista de aprobaciones",
    noDocuments: "No hay documentos.",
  },
  "fr-FR": {
    approvalListTitle: "Liste d'approbation",
    noDocuments: "Aucun document.",
  },
  "de-DE": {
    approvalListTitle: "Freigabeliste",
    noDocuments: "Keine Dokumente.",
  },
};

export default function App() {
  const [token, setToken] = useState("");
  const [locale, setLocale] = useState<AppLocale>(resolveLocale(window.localStorage.getItem("moaworks.locale")));
  const copy = userCopy[locale];
  const [timezone, setTimezone] = useState(window.localStorage.getItem("moaworks.timezone") || "Asia/Seoul");
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
      setTranslationError("로그인 후 번역 데모를 실행해 주세요.");
      return;
    }
    const trimmed = translationSource.trim();
    if (!trimmed) {
      setTranslationError("번역 원문을 입력하세요.");
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
      setMessage(`로그인 성공: ${response.user.userName}`);
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
      setMessage("작성 완료 (임시 저장)");
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
      await act(token, documentId, reasonAction.reason || "동의");
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

  function isCurrentApprover(doc: ApprovalDocument): boolean {
    if (!me) return false;
    if (doc.currentLineIndex == null) return false;
    const line = doc.lines.find((item) => item.sequence === doc.currentLineIndex);
    return Boolean(line && line.approverUserId === me.userId);
  }

  return (
    <main style={{ fontFamily: "Segoe UI, Noto Sans KR, sans-serif", padding: "24px" }}>
      <h1>{t(locale, "appTitle")}</h1>
      <p>{t(locale, "appSubtitle")}</p>

      <section>
        <h2>{t(locale, "language")} / {t(locale, "timezone")}</h2>
        <label>
          {t(locale, "language")}
          <select value={locale} onChange={(event) => saveLocale(event.target.value as AppLocale)}>
            {supportedLocales.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, "timezone")}
          <select value={timezone} onChange={(event) => saveTimezone(event.target.value)}>
            {supportedTimezones.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <p style={{ color: "#64748b", fontSize: "12px" }}>
          현재 표시 기준: {timezone}
        </p>
      </section>

      {!token ? (
        <section>
          <h2>{t(locale, "loginTitle")}</h2>
          <form onSubmit={handleLogin}>
            <div>
              <label>{t(locale, "email")}</label>
              <input
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="user@moaworks.local"
              />
            </div>
            <div>
              <label>{t(locale, "password")}</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>
            <button disabled={loading}>{t(locale, "loginButton")}</button>
          </form>
        </section>
      ) : (
        <>
        <section>
          <h2>{t(locale, "translationSectionTitle")}</h2>
          <p style={{ marginTop: 4, color: "#64748b" }}>{t(locale, "translationPolicy")} (Provider: {translationStatus?.provider || "unknown"})</p>
          <form onSubmit={runTranslationDemo}>
            <label>
              {t(locale, "translationSourceText")}
              <textarea value={translationSource} onChange={(event) => setTranslationSource(event.target.value)} />
            </label>
            <label>
              {t(locale, "translationTargetLocale")}
              <select value={translationTargetLocale} onChange={(event) => setTranslationTargetLocale(event.target.value)}>
                <option value="en">en</option>
                <option value="ja">ja</option>
                <option value="ko">ko</option>
                <option value="zh-cn">zh-cn</option>
                <option value="es">es</option>
                <option value="fr">fr</option>
                <option value="de">de</option>
              </select>
            </label>
            <button type="submit" disabled={translationLoading}>
              {translationLoading ? t(locale, "retry") : t(locale, "translate")}
            </button>
          </form>
          {translationError && <p style={{ color: "crimson" }}>{translationError}</p>}
          {translationResult.length > 0 ? (
            <div>
              {translationResult.map((item) => (
                <div key={`${item.sourceLocale}-${item.targetLocale}-${item.originalText}`} style={{ border: "1px solid #d2dbe2", padding: 8, marginTop: 8 }}>
                  <p>
                    [{item.sourceLocale} → {item.targetLocale}] {item.translated ? `${t(locale, "translationResult")}` : t(locale, "translationOriginalOnly")}
                  </p>
                  <p style={{ marginTop: 4 }}>{t(locale, "translationOriginalLabel")}: {item.originalText}</p>
                  <p style={{ marginTop: 4, color: "#0f766e" }}>{t(locale, "translationTranslatedLabel")}: {item.translatedText}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section>
            <h2>{t(locale, "notifications")}</h2>
            <p style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
              {t(locale, "notificationsMode")}: {notificationMode === "streaming" ? t(locale, "notificationModeStreaming") : t(locale, "notificationModePolling")}
              {notificationMode === "fallback" ? ` (${t(locale, "notificationModeFallback")})` : ""}
            </p>
            {notificationSummary && (
              <p>
                {tf(
                  locale,
                  "notificationSummaryDetail",
                  String(notificationSummary.unreadCount),
                  String(notificationSummary.severityCount.CRITICAL),
                  String(notificationSummary.severityCount.WARN),
                )}
              </p>
            )}
            <button type="button" onClick={() => void refreshNotifications(token)} disabled={loading}>
              {t(locale, "commonRefresh")} {t(locale, "notifications")}
            </button>
            {notificationError && <p style={{ color: "crimson" }}>{t(locale, "notificationError")}: {notificationError}</p>}
            <div style={{ marginTop: "8px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>{t(locale, "notificationCategory")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "notificationTitle")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "notificationMessage")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "notificationStatus")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "notificationAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((item) => (
                    <tr key={item.notificationId}>
                      <td>{item.category}</td>
                      <td>{item.title}</td>
                      <td>{item.message}</td>
                      <td>{item.status}</td>
                      <td>
                        <button type="button" onClick={() => void executeAck(item.notificationId)} disabled={loading || item.status !== "unread"}>
                          {t(locale, "notificationAck")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {notifications.length === 0 && <tr><td colSpan={5}>{t(locale, "notificationListEmpty")}</td></tr>}
                </tbody>
              </table>
            </div>
            {notificationError && (
              <div>
                <button type="button" onClick={() => void refreshNotifications(token)} disabled={loading}>
                  {t(locale, "manualRefresh")}
                </button>
              </div>
            )}
          </section>

          <section>
            <h2>{t(locale, "currentUser")}</h2>
            <p>
              {me?.userName} ({me?.roleName || t(locale, "currentRoleMissing")}) / 권한 {canAct.create ? t(locale, "currentCapabilityCreate") : t(locale, "currentCapabilityReadOnly")}
            </p>
            <p>{t(locale, "tokenOwner")}: {me?.userEmail}</p>
            <p>{t(locale, "auditLogCount")}: {logsCount}</p>
            <button
              onClick={() => {
                clearUserToken();
                setToken("");
                setMe(null);
              }}
            >
              {t(locale, "logout")}
            </button>
          </section>

          {canAct.create && (
            <section>
              <h2>{t(locale, "approvalWrite")}</h2>
              <form onSubmit={handleCreate}>
                <div>
                  <label>{t(locale, "approvalTitle")}</label>
                  <input value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} />
                </div>
                <div>
                  <label>{t(locale, "approvalContent")}</label>
                  <textarea
                    value={createForm.content}
                    onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))}
                  />
                </div>
                <div>
                  <label>{t(locale, "approvalApprovers")}</label>
                  <input
                    value={createForm.approverUserIds}
                    onChange={(event) => setCreateForm((current) => ({ ...current, approverUserIds: event.target.value }))}
                    placeholder="user_123456,user_abcdef"
                  />
                </div>
                <button disabled={loading}>{t(locale, "approvalCreateAction")}</button>
              </form>
            </section>
          )}

          <section>
            <h2>{copy.approvalListTitle}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>{t(locale, "approvalDocumentTitle")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "approvalDocumentStatus")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "approvalDocumentCreator")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "approvalDocumentCurrent")}</th>
                    <th style={{ textAlign: "left" }}>{t(locale, "approvalDocumentActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => {
                    const currentLine = doc.currentLineIndex == null ? null : doc.lines.find((item) => item.sequence === doc.currentLineIndex) ?? null;
                    return (
                      <tr key={doc.id}>
                        <td>{doc.title}</td>
                        <td>{doc.status}</td>
                        <td>{doc.creatorUserName}</td>
                        <td>
                          {currentLine ? `${currentLine.approverUserName} / ${currentLine.status}` : "-"}
                          {currentLine?.comment ? ` / ${currentLine.comment}` : ""}
                        </td>
                        <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {doc.status === "draft" && canAct.submit && doc.creatorUserId === me?.userId && (
                            <button onClick={() => void executeSubmit(doc.id, "submit")} disabled={loading}>
                              {t(locale, "submit")}
                            </button>
                          )}
                          {doc.status === "submitted" && doc.creatorUserId === me?.userId && canAct.withdraw && (
                            <button onClick={() => void executeSubmit(doc.id, "withdraw")} disabled={loading}>
                              {t(locale, "withdraw")}
                            </button>
                          )}
                          {doc.status === "rejected" && doc.creatorUserId === me?.userId && canAct.rework && (
                            <button onClick={() => void executeSubmit(doc.id, "redraft")} disabled={loading}>
                              {t(locale, "redraft")}
                            </button>
                          )}
                          {doc.status === "submitted" && canAct.act && isCurrentApprover(doc) && (
                            <>
                              <input
                                value={doc.id === reasonAction.documentId ? reasonAction.reason : ""}
                                placeholder={t(locale, "approvalReason")}
                                onChange={(event) => setReasonAction({ documentId: doc.id, reason: event.target.value })}
                                style={{ minWidth: 140 }}
                              />
                              <button
                                onClick={() => {
                                  void executeApprove(doc.id, true);
                                }}
                                disabled={loading}
                              >
                                {t(locale, "approve")}
                              </button>
                              <button
                                onClick={() => {
                                  void executeApprove(doc.id, false);
                                }}
                                disabled={loading}
                              >
                                {t(locale, "reject")}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {documents.length === 0 && <p>{copy.noDocuments}</p>}
          </section>
        </>
      )}

      {approvalError && <p style={{ color: "crimson" }}>{approvalError}</p>}
      {message && <p style={{ color: "green" }}>{message}</p>}
    </main>
  );
}
