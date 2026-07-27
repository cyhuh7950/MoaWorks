import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { CommonPopup } from "./components/CommonPopup";
import type { WorkspaceCalendar, WorkspaceDirectory } from "./api";
import { scheduleDraftPayload, type ScheduleDraft } from "./scheduleForm";

type Props = {
  open: boolean;
  draft: ScheduleDraft;
  users: WorkspaceDirectory["users"];
  ownerUserId: string;
  ownedCalendars: WorkspaceCalendar[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: ReturnType<typeof scheduleDraftPayload>, scheduleId: string | null) => Promise<void>;
};

const alertOptions = [{ value: 0, label: "시작 시" }, { value: 10, label: "10분 전" }, { value: 30, label: "30분 전" }, { value: 60, label: "1시간 전" }, { value: 1440, label: "1일 전" }];

export function ScheduleComposePopup({ open, draft, users, ownerUserId, ownedCalendars, saving, error, onClose, onSave }: Props) {
  const [form, setForm] = useState(draft);
  const [localError, setLocalError] = useState("");
  const [search, setSearch] = useState("");
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const closeRequestRef = useRef<(() => void) | null>(null);
  useEffect(() => { if (open) { setForm(draft); setLocalError(""); setSearch(""); } }, [draft, open]);
  const candidates = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return users.filter((user) => user.id !== ownerUserId && (!needle || `${user.name} ${user.email} ${user.department_name}`.toLocaleLowerCase().includes(needle)));
  }, [ownerUserId, search, users]);
  const dirty = JSON.stringify(form) !== JSON.stringify(draft);
  const update = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleAttendee = (userId: string) => setForm((current) => {
    const selected = current.attendeeUserIds.includes(userId);
    if (!selected && current.attendeeUserIds.length >= 50) { setLocalError("참석자는 최대 50명까지 선택할 수 있습니다."); return current; }
    setLocalError("");
    return { ...current, attendeeUserIds: selected ? current.attendeeUserIds.filter((id) => id !== userId) : [...current.attendeeUserIds, userId] };
  });
  const toggleAlert = (minutes: number) => setForm((current) => {
    const selected = current.alertMinutes.includes(minutes);
    if (!selected && current.alertMinutes.length >= 3) { setLocalError("알림은 최대 3개까지 선택할 수 있습니다."); return current; }
    setLocalError("");
    return { ...current, alertMinutes: selected ? current.alertMinutes.filter((item) => item !== minutes) : [...current.alertMinutes, minutes] };
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try { setLocalError(""); await onSave(scheduleDraftPayload(form), form.scheduleId); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : "입력값을 확인하세요."); }
  };

  return <CommonPopup title={form.scheduleId === null ? "일정 만들기" : "일정 수정"} open={open} onClose={onClose} dirty={dirty} saving={saving} error={localError || error} initialFocusRef={initialFocusRef} closeRequestRef={closeRequestRef} className="ui038-schedule-popup">
    <form className="ui038-schedule-form" onSubmit={submit}>
      <label className="is-wide"><span>캘린더</span><select required value={form.calendarId} onChange={(event) => update("calendarId", event.target.value)}>{ownedCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.isDefault ? " (기본)" : ""}</option>)}</select></label>
      <label className="is-wide"><span>제목</span><input ref={initialFocusRef} required maxLength={160} value={form.title} onChange={(event) => update("title", event.target.value)} /></label>
      <label><span>시작</span><input required type="datetime-local" value={form.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></label>
      <label><span>종료</span><input required type="datetime-local" value={form.endsAt} onChange={(event) => update("endsAt", event.target.value)} /></label>
      <label className="is-wide"><span>위치</span><input maxLength={500} value={form.location} onChange={(event) => update("location", event.target.value)} /></label>
      <fieldset className="is-wide"><legend>참석자</legend><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름, 이메일, 부서 검색" aria-label="참석자 검색"/><div className="ui038-attendee-list">{candidates.map((user) => <label key={user.id}><input type="checkbox" checked={form.attendeeUserIds.includes(user.id)} onChange={() => toggleAttendee(user.id)} /><span><strong>{user.name}</strong>{user.email} · {user.department_name || "부서 없음"}</span></label>)}</div><small>{form.attendeeUserIds.length}/50명 선택</small></fieldset>
      <label><span>반복</span><select value={form.repeatType} onChange={(event) => update("repeatType", event.target.value as ScheduleDraft["repeatType"])}><option value="none">반복 없음</option><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option></select></label>
      <label><span>반복 종료일</span><input type="date" disabled={form.repeatType === "none"} required={form.repeatType !== "none"} min={form.startsAt.slice(0, 10)} value={form.repeatUntil} onChange={(event) => update("repeatUntil", event.target.value)} /></label>
      <fieldset className="is-wide"><legend>알림 <small>최대 3개</small></legend><div className="ui038-alerts">{alertOptions.map((option) => <label key={option.value}><input type="checkbox" checked={form.alertMinutes.includes(option.value)} onChange={() => toggleAlert(option.value)} />{option.label}</label>)}</div></fieldset>
      <label className="is-wide"><span>설명</span><textarea maxLength={4000} rows={4} value={form.description} onChange={(event) => update("description", event.target.value)} /></label>
      <label className="is-wide"><span>시간대</span><input required value={form.timezone} onChange={(event) => update("timezone", event.target.value)} /></label>
      <footer className="is-wide"><button type="button" onClick={() => closeRequestRef.current?.()} disabled={saving}>취소</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "저장 중" : "저장"}</button></footer>
    </form>
  </CommonPopup>;
}
