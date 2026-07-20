import { useEffect, useMemo, useRef, useState } from "react";

import {
  archiveNotifications,
  bulkReadNotifications,
  fetchNotificationPreferences,
  fetchNotifications,
  readAllNotifications,
  saveNotificationPreferences,
  type NotificationPreferences,
  type NotificationRecord,
} from "./api";
import { CommonPopup } from "./components/CommonPopup";

type PortalMenu = "mail" | "approval" | "messenger" | "schedule" | "files" | "notices" | "alerts";
type Props = {
  token: string;
  onChanged: () => Promise<void>;
  onNavigate: (menu: PortalMenu, item: NotificationRecord) => void;
};
type ReadStatusFilter = "all" | "unread" | "read";

const categoryLabels: Record<string, string> = {
  mail: "메일",
  approval: "전자결재",
  messenger: "메신저",
  schedule: "일정",
  file: "파일",
  notice: "공지",
  system: "시스템 공지",
};

const emptyPreferences: NotificationPreferences = {
  enabled: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  categories: Object.fromEntries(Object.keys(categoryLabels).map((key) => [key, { enabled: true, importantOnly: false }])),
  updatedAt: null,
};

function resolveMenu(item: NotificationRecord): PortalMenu {
  const value = (item.resourceType || item.category).toLowerCase();
  if (value.includes("mail")) return "mail";
  if (value.includes("approval")) return "approval";
  if (value.includes("message") || value.includes("room")) return "messenger";
  if (value.includes("schedule") || value.includes("calendar")) return "schedule";
  if (value.includes("file")) return "files";
  if (value.includes("notice")) return "notices";
  return "alerts";
}

export function NotificationCenter({ token, onChanged, onNavigate }: Props) {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [readStatus, setReadStatus] = useState<ReadStatusFilter>("all");
  const [category, setCategory] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [period, setPeriod] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<NotificationPreferences>(emptyPreferences);
  const [savedSettings, setSavedSettings] = useState<NotificationPreferences>(emptyPreferences);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const settingsFirstRef = useRef<HTMLInputElement>(null);
  const settingsCloseRequestRef = useRef<(() => void) | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const days = Number(period);
      const response = await fetchNotifications(token, {
        unreadOnly: readStatus === "unread",
        category: category === "all" ? undefined : category,
        severity: severity === "all" ? undefined : [severity],
        fromAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : undefined,
        limit: 100,
      });
      setItems(response.notifications);
      setSelectedIds(current => current.filter(id => response.notifications.some(item => item.notificationId === id)));
      setSelectedId(current => response.notifications.some(item => item.notificationId === current) ? current : response.notifications[0]?.notificationId ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "알림을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token, readStatus, category, severity, period]);

  const visibleItems = useMemo(() => {
    const days = Number(period);
    const cutoff = Number.isFinite(days) && days > 0 ? Date.now() - days * 86400000 : null;
    return items.filter(item => {
      if (cutoff !== null && new Date(item.occurredAt).getTime() < cutoff) return false;
      if (readStatus === "read" && item.status !== "read") return false;
      if (readStatus === "unread" && item.status !== "unread") return false;
      return true;
    });
  }, [items, period, readStatus]);

  useEffect(() => {
    const visibleIds = new Set(visibleItems.map(item => item.notificationId));
    setSelectedIds(current => {
      const next = current.filter(id => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
    setSelectedId(current => visibleIds.has(current) ? current : visibleItems[0]?.notificationId ?? "");
  }, [visibleItems]);

  const selected = visibleItems.find(item => item.notificationId === selectedId) ?? null;
  const allSelected = visibleItems.length > 0 && visibleItems.every(item => selectedIds.includes(item.notificationId));

  const refreshAll = async () => {
    await load();
    await onChanged();
  };

  const markSelectedRead = async () => {
    if (!selectedIds.length) return;
    setLoading(true);
    setError("");
    try {
      await bulkReadNotifications(token, selectedIds);
      setSelectedIds([]);
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "선택 알림을 읽음 처리하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const markOneRead = async (notificationId: string) => {
    setLoading(true);
    setError("");
    try {
      await bulkReadNotifications(token, [notificationId]);
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "알림을 읽음 처리하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const markAllRead = async () => {
    setLoading(true);
    setError("");
    try {
      await readAllNotifications(token, {
        category: category === "all" ? undefined : category,
        severity: severity === "all" ? undefined : [severity],
      });
      setSelectedIds([]);
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "전체 읽음 처리에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const archiveSelected = async () => {
    if (!selectedIds.length) return;
    setLoading(true);
    setError("");
    setArchiveError("");
    try {
      await archiveNotifications(token, selectedIds);
      setSelectedIds([]);
      setArchiveConfirmOpen(false);
      await refreshAll();
    } catch (nextError) {
      setArchiveError(nextError instanceof Error ? nextError.message : "선택 알림을 삭제하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const openSettings = async () => {
    setSettingsError("");
    try {
      const value = await fetchNotificationPreferences(token);
      setSettings(value);
      setSavedSettings(value);
      setSettingsOpen(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "알림 설정을 불러오지 못했습니다.");
    }
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const value = await saveNotificationPreferences(token, settings);
      setSettings(value);
      setSavedSettings(value);
      setSettingsOpen(false);
      await onChanged();
    } catch (nextError) {
      setSettingsError(nextError instanceof Error ? nextError.message : "알림 설정을 저장하지 못했습니다.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateCategory = (key: string, field: "enabled" | "importantOnly", checked: boolean) => {
    setSettings(current => ({
      ...current,
      categories: {
        ...current.categories,
        [key]: { ...(current.categories[key] ?? { enabled: true, importantOnly: false }), [field]: checked },
      },
    }));
  };

  return <section className="notification-center">
    <header className="notification-center-toolbar">
      <div>
        <h1>전체 알림</h1>
        <span>업무 알림을 조회하고 원본 화면으로 이동합니다.</span>
      </div>
      <div className="notification-center-actions">
        <button type="button" onClick={() => void markAllRead()} disabled={loading}>전체 읽음</button>
        <button type="button" onClick={() => void openSettings()}>알림 설정</button>
      </div>
    </header>

    <div className="notification-center-filters" aria-label="알림 필터">
      <label><span>상태</span><select value={readStatus} onChange={event => setReadStatus(event.target.value as ReadStatusFilter)}><option value="all">전체</option><option value="unread">미확인</option><option value="read">확인 완료</option></select></label>
      <label><span>업무 유형</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">전체</option>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label><span>중요도</span><select value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">전체</option><option value="CRITICAL">긴급</option><option value="ERROR">오류</option><option value="WARN">경고</option><option value="INFO">정보</option></select></label>
      <label><span>기간</span><select value={period} onChange={event => setPeriod(event.target.value)}><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option><option value="0">전체</option></select></label>
    </div>

    {error ? <div className="notification-center-error" role="alert">{error}</div> : null}

    <div className="notification-center-selection">
      <label><input type="checkbox" checked={allSelected} onChange={event => setSelectedIds(event.target.checked ? visibleItems.map(item => item.notificationId) : [])} /> 전체 선택</label>
      <span>{selectedIds.length}개 선택</span>
      <button type="button" onClick={() => void markSelectedRead()} disabled={!selectedIds.length || loading}>읽음 처리</button>
      <button type="button" onClick={() => { setArchiveError(""); setArchiveConfirmOpen(true); }} disabled={!selectedIds.length || loading}>삭제</button>
      <button type="button" onClick={() => void load()} disabled={loading}>새로고침</button>
    </div>

    <div className="notification-center-split">
      <div className="notification-center-list" role="list" aria-busy={loading}>
        {loading && !items.length ? <div className="notification-center-state">알림을 불러오는 중입니다.</div> : null}
        {!loading && !visibleItems.length ? <div className="notification-center-state">조건에 맞는 알림이 없습니다.</div> : null}
        {visibleItems.map(item => <article key={item.notificationId} className={`notification-center-row ${item.status === "unread" ? "is-unread" : ""} ${selectedId === item.notificationId ? "is-selected" : ""}`} role="listitem">
          <input aria-label={`${item.title} 선택`} type="checkbox" checked={selectedIds.includes(item.notificationId)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, item.notificationId] : current.filter(id => id !== item.notificationId))} />
          <button type="button" onClick={() => setSelectedId(item.notificationId)}>
            <span>{categoryLabels[item.category] ?? item.category}</span>
            <strong>{item.title}</strong>
            <small>{new Date(item.occurredAt).toLocaleString("ko-KR")} · {item.status === "unread" ? "읽지 않음" : "읽음"}</small>
          </button>
        </article>)}
      </div>

      <aside className="notification-center-detail">
        {selected ? <>
          <div className="notification-center-detail-meta"><span>{categoryLabels[selected.category] ?? selected.category}</span><span>{selected.severity}</span></div>
          <h2>{selected.title}</h2>
          <time>{new Date(selected.occurredAt).toLocaleString("ko-KR")}</time>
          <p>{selected.message}</p>
          <dl><div><dt>원본 유형</dt><dd>{selected.resourceType}</dd></div><div><dt>처리 상태</dt><dd>{selected.status === "unread" ? "읽지 않음" : "읽음"}</dd></div></dl>
          <div className="notification-center-detail-actions">
            {selected.status === "unread" ? <button type="button" onClick={() => void markOneRead(selected.notificationId)} disabled={loading}>읽음 처리</button> : null}
            <button type="button" className="notification-center-primary" onClick={() => onNavigate(resolveMenu(selected), selected)}>원본으로 이동</button>
          </div>
        </> : <div className="notification-center-state">알림을 선택하면 상세 내용을 확인할 수 있습니다.</div>}
      </aside>
    </div>

    <CommonPopup title="알림 삭제" open={archiveConfirmOpen} onClose={() => { if (!loading) setArchiveConfirmOpen(false); }} error={archiveError} saving={loading} kind="alertdialog">
      <p className="feedback-confirm-message">선택한 {selectedIds.length}개 알림을 목록에서 삭제할까요? 원본 업무는 삭제되지 않습니다.</p>
      <div className="feedback-confirm-actions">
        <button type="button" onClick={() => setArchiveConfirmOpen(false)} disabled={loading}>취소</button>
        <button type="button" className="is-destructive" onClick={() => void archiveSelected()} disabled={loading}>삭제</button>
      </div>
    </CommonPopup>

    <CommonPopup title="알림 설정" open={settingsOpen} onClose={() => setSettingsOpen(false)} dirty={JSON.stringify(settings) !== JSON.stringify(savedSettings)} error={settingsError} saving={settingsSaving} initialFocusRef={settingsFirstRef} closeRequestRef={settingsCloseRequestRef}>
      <div className="notification-settings-form">
        <label className="notification-settings-master"><input ref={settingsFirstRef} type="checkbox" checked={settings.enabled} onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))} /> 앱 내 알림 사용</label>
        <div className="notification-settings-grid">
          {Object.entries(categoryLabels).map(([key, label]) => <fieldset key={key}><legend>{label}</legend><label><input type="checkbox" checked={settings.categories[key]?.enabled ?? true} onChange={event => updateCategory(key, "enabled", event.target.checked)} /> 알림 사용</label><label><input type="checkbox" checked={settings.categories[key]?.importantOnly ?? false} onChange={event => updateCategory(key, "importantOnly", event.target.checked)} /> 중요 알림만</label></fieldset>)}
        </div>
        <label className="notification-settings-master"><input type="checkbox" checked={settings.quietHoursEnabled} onChange={event => setSettings(current => ({ ...current, quietHoursEnabled: event.target.checked }))} /> 방해 금지 시간 사용</label>
        <div className="notification-settings-times"><label><span>시작</span><input type="time" value={settings.quietHoursStart} onChange={event => setSettings(current => ({ ...current, quietHoursStart: event.target.value }))} /></label><label><span>종료</span><input type="time" value={settings.quietHoursEnd} onChange={event => setSettings(current => ({ ...current, quietHoursEnd: event.target.value }))} /></label></div>
        <div className="notification-settings-footer"><button type="button" onClick={() => settingsCloseRequestRef.current?.()}>취소</button><button type="button" className="notification-center-primary" onClick={() => void saveSettings()} disabled={settingsSaving}>저장</button></div>
      </div>
    </CommonPopup>
  </section>;
}
