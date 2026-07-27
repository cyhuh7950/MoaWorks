import React, { FormEvent, useEffect, useState } from "react";

import {
  cancelCalendarSubscription,
  createCalendar,
  createCalendarSubscription,
  decideCalendarSubscription,
  deleteCalendar,
  discoverCalendars,
  reorderCalendars,
  updateCalendar,
  type CalendarVisibility,
  type WorkspaceCalendar,
  type WorkspaceCalendarData,
} from "./api";
import { calendarColors, moveOwnedCalendar } from "./calendarSettings";

type Props = { token: string; data: WorkspaceCalendarData; onChanged: () => Promise<void>; onBack: () => void };
type Tab = "owned" | "subscriptions";

const visibilityLabels: Array<{ value: CalendarVisibility; label: string }> = [
  { value: "public", label: "공개" },
  { value: "approval_required", label: "수락 후 공개" },
  { value: "private", label: "비공개" },
];

export function CalendarSettingsPanel({ token, data, onChanged, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("owned");
  const [name, setName] = useState("");
  const [color, setColor] = useState<(typeof calendarColors)[number]>(calendarColors[0]);
  const [query, setQuery] = useState("");
  const [discovered, setDiscovered] = useState<WorkspaceCalendar[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setDiscovered([]); }, [tab]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "요청 처리에 실패했습니다."); }
    finally { setBusy(false); }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await act(async () => { await createCalendar(token, { name: name.trim(), color }); setName(""); });
  }

  async function patch(calendar: WorkspaceCalendar, values: Partial<{ name: string; color: string; visibility: CalendarVisibility; isDefault: boolean }>) {
    await act(() => updateCalendar(token, calendar.id, { ...values, expectedVersion: calendar.version }));
  }

  async function move(calendarId: string, direction: -1 | 1) {
    const next = moveOwnedCalendar(data.owned, calendarId, direction);
    if (next === data.owned) return;
    await act(() => reorderCalendars(token, next));
  }

  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setDiscovered((await discoverCalendars(token, query.trim())).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "캘린더 검색에 실패했습니다."); }
    finally { setBusy(false); }
  }

  return <main className="ui039-calendar-settings">
    <header><div><button type="button" onClick={onBack}>캘린더로 돌아가기</button><h2>내 캘린더 관리</h2></div><button type="button" className="ui037-help" aria-label="캘린더 설정 도움말" data-tooltip="내 캘린더와 관심 캘린더의 공개 범위와 구독을 관리합니다.">i</button></header>
    <nav aria-label="캘린더 설정"><button type="button" aria-pressed={tab === "owned"} onClick={() => setTab("owned")}>내 캘린더</button><button type="button" aria-pressed={tab === "subscriptions"} onClick={() => setTab("subscriptions")}>관심 캘린더</button></nav>
    {error ? <p role="alert" className="ui039-error">{error}</p> : null}

    {tab === "owned" ? <>
      <form className="ui039-add" onSubmit={add}><label><span>캘린더 이름</span><input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>색상</span><select value={color} onChange={(event) => setColor(event.target.value as typeof color)}>{calendarColors.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button disabled={busy || !name.trim()}>캘린더 추가</button></form>
      <section className="ui039-owned-list">{data.owned.map((calendar, index) => <article key={calendar.id}>
        <i style={{ background: calendar.color }} aria-hidden="true" />
        <label><span>이름</span><input defaultValue={calendar.name} onBlur={(event) => event.target.value.trim() !== calendar.name && void patch(calendar, { name: event.target.value.trim() })} /></label>
        <label><span>색상</span><select value={calendar.color} onChange={(event) => void patch(calendar, { color: event.target.value })}>{calendarColors.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>공개 범위</span><select value={calendar.visibility} onChange={(event) => void patch(calendar, { visibility: event.target.value as CalendarVisibility })}>{visibilityLabels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="ui039-default"><input type="radio" name="default-calendar" checked={calendar.isDefault} onChange={() => !calendar.isDefault && void patch(calendar, { isDefault: true })} /> 기본 캘린더</label>
        <div className="ui039-actions"><button type="button" disabled={busy || index === 0} onClick={() => void move(calendar.id, -1)}>위로</button><button type="button" disabled={busy || index === data.owned.length - 1} onClick={() => void move(calendar.id, 1)}>아래로</button><button type="button" disabled={busy || calendar.isDefault} onClick={() => setConfirmDeleteId(calendar.id)}>삭제</button></div>
        {confirmDeleteId === calendar.id ? <div className="ui039-confirm" role="alert"><p>해당 일정도 함께 삭제되어 화면에서 복구할 수 없음 ({calendar.activeScheduleCount}개)</p><button type="button" onClick={() => setConfirmDeleteId("")}>취소</button><button type="button" className="is-danger" onClick={() => void act(async () => { await deleteCalendar(token, calendar); setConfirmDeleteId(""); })}>삭제 확인</button></div> : null}
      </article>)}</section>
      <section className="ui039-incoming"><h3>내 일정을 보고 있는 동료</h3>{data.incomingRequests.length ? data.incomingRequests.map((item) => <article key={item.subscriptionId}><span><strong>{item.subscriber.name}</strong><small>{item.subscriber.department}</small></span><span>{item.calendar.name}</span><div><button type="button" onClick={() => void act(() => decideCalendarSubscription(token, item.subscriptionId, "accept"))}>수락</button><button type="button" onClick={() => void act(() => decideCalendarSubscription(token, item.subscriptionId, "reject"))}>거절</button></div></article>) : <p>대기 중인 요청이 없습니다.</p>}</section>
    </> : <>
      <form className="ui039-search" onSubmit={search}><label><span>동료 캘린더 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 캘린더" /></label><button disabled={busy}>검색</button></form>
      <section><h3>검색 결과</h3>{discovered.length ? discovered.map((calendar) => <article className="ui039-sub-row" key={calendar.id}><i style={{ background: calendar.color }} /><span><strong>{calendar.name}</strong><small>{calendar.ownerUserName} · {visibilityLabels.find((item) => item.value === calendar.visibility)?.label}</small></span><button type="button" disabled={busy || data.subscriptions.some((item) => item.calendar.id === calendar.id)} onClick={() => void act(() => createCalendarSubscription(token, calendar.id))}>관심 등록</button></article>) : <p>검색 결과가 없습니다.</p>}</section>
      <section><h3>관심 캘린더</h3>{data.subscriptions.length ? data.subscriptions.map((item) => <article className="ui039-sub-row" key={item.subscriptionId}><i style={{ background: item.calendar.color }} /><span><strong>{item.calendar.name}</strong><small>{item.calendar.ownerUserName} · {item.status === "active" ? "공개 중" : "수락 대기"}</small></span><button type="button" onClick={() => void act(() => cancelCalendarSubscription(token, item.subscriptionId))}>해제</button></article>) : <p>등록된 관심 캘린더가 없습니다.</p>}</section>
    </>}
  </main>;
}
