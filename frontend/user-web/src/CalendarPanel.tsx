import React, { useMemo, useState } from "react";

import type { WorkspaceSchedule } from "./api";
import { calendarDays, dateKey, eventsForDay, filterCalendarEvents, formatCalendarRangeTitle, getCalendarRange, navigateCalendarDate, type CalendarView } from "./calendar";

type Props = {
  schedules: WorkspaceSchedule[];
  selectedId: string;
  locale: string;
  timezone: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onEdit: (item: WorkspaceSchedule) => void;
  onDelete: () => void;
};

const views: Array<{ key: CalendarView; label: string }> = [
  { key: "month", label: "월" }, { key: "week", label: "주" }, { key: "day", label: "일" }, { key: "list", label: "목록" },
];
const hours = Array.from({ length: 24 }, (_, index) => index);

function timeLabel(value: string, locale: string, timezone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
}

function dateTimeLabel(value: string, locale: string, timezone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function EventButton({ item, selected, locale, timezone, onSelect }: { item: WorkspaceSchedule; selected: boolean; locale: string; timezone: string; onSelect: (id: string) => void }) {
  return <button type="button" className={`ui037-event${selected ? " is-selected" : ""}`} onClick={() => onSelect(item.id)} title={`${dateTimeLabel(item.starts_at, locale, timezone)} – ${dateTimeLabel(item.ends_at, locale, timezone)}`}><span>{timeLabel(item.starts_at, locale, timezone)}</span><strong>{item.title}</strong></button>;
}

export function CalendarPanel({ schedules, selectedId, locale, timezone, loading, error, onRetry, onCreate, onSelect, onEdit, onDelete }: Props) {
  const [view, setView] = useState<CalendarView>("month");
  const [baseDate, setBaseDate] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const range = useMemo(() => getCalendarRange(view, baseDate, timezone), [view, baseDate, timezone]);
  const visible = useMemo(() => filterCalendarEvents(schedules, range, query), [schedules, range, query]);
  const days = useMemo(() => calendarDays(view, baseDate, timezone), [view, baseDate, timezone]);
  const selected = schedules.find((item) => item.id === selectedId) ?? null;
  const todayKey = dateKey(new Date(), timezone);
  const baseMonth = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "2-digit" }).format(baseDate);
  const move = (direction: -1 | 1) => setBaseDate((current) => navigateCalendarDate(current, view, direction, timezone));
  const openDayList = (day: Date) => { setBaseDate(day); setView("list"); };

  const empty = !loading && !error && visible.length === 0;
  return <section className={`ui037-calendar-shell${loading ? " is-loading" : ""}`} aria-busy={loading}>
    <aside className="ui037-calendar-source" aria-label="캘린더 목록">
      <button type="button" className="ui037-primary" onClick={onCreate} disabled={loading}>일정 만들기</button>
      <section><h3>내 캘린더</h3><label><input type="checkbox" checked readOnly disabled={loading} /> 내 일정</label></section>
      {(["관심 캘린더", "부서 캘린더", "전사 캘린더"] as const).map((title) => <section key={title}><h3>{title}</h3><p>등록된 캘린더 없음</p></section>)}
    </aside>

    <main className="ui037-calendar-main">
      <header className="ui037-toolbar">
        <div className="ui037-navigation"><button type="button" onClick={() => move(-1)} aria-label="이전 범위" disabled={loading}>‹</button><button type="button" onClick={() => setBaseDate(new Date())} disabled={loading}>오늘</button><button type="button" onClick={() => move(1)} aria-label="다음 범위" disabled={loading}>›</button></div>
        <h2>{formatCalendarRangeTitle(view, baseDate, locale, timezone)}</h2>
        <div className="ui037-tools"><label><span className="ui037-sr-only">일정 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="일정 검색" disabled={loading} /></label><div className="ui037-segments" aria-label="캘린더 보기">{views.map((item) => <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => setView(item.key)} disabled={loading}>{item.label}</button>)}</div><button type="button" className="ui037-help" aria-label="캘린더 도움말" data-tooltip="날짜 이동과 보기를 전환하고 개인 일정을 검색할 수 있습니다.">i</button></div>
      </header>

      {error ? <div className="ui037-state is-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>다시 시도</button></div> : null}
      {loading ? <div className="ui037-skeleton" aria-label="일정 불러오는 중">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div> : null}
      {!loading && !error && query.trim() && empty ? <div className="ui037-state"><p>검색 결과가 없습니다.</p><button type="button" onClick={() => setQuery("")}>검색 초기화</button></div> : null}
      {!loading && !error && !query.trim() && empty ? <div className="ui037-state"><p>현재 범위에 일정이 없습니다.</p><button type="button" onClick={onCreate}>일정 만들기</button></div> : null}

      {!loading && !error && !empty && view === "month" ? <section className="ui037-month" aria-label="월간 일정"><div className="ui037-weekdays">{"일월화수목금토".split("").map((day) => <span key={day}>{day}</span>)}</div><div className="ui037-month-grid">{days.map((day) => { const items = eventsForDay(visible, day, timezone); const dayMonth = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "2-digit" }).format(day); return <article key={dateKey(day, timezone)} className={`${dayMonth !== baseMonth ? "is-outside " : ""}${dateKey(day, timezone) === todayKey ? "is-today" : ""}`}><header><time>{new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric" }).format(day)}</time></header>{items.slice(0, 3).map((item) => <EventButton key={item.id} item={item} selected={item.id === selectedId} locale={locale} timezone={timezone} onSelect={onSelect} />)}{items.length > 3 ? <button type="button" className="ui037-more" onClick={() => openDayList(day)}>+{items.length - 3}개</button> : null}</article>; })}</div></section> : null}

      {!loading && !error && !empty && (view === "week" || view === "day") ? <section className={`ui037-time-grid is-${view}`} aria-label={view === "week" ? "주간 일정" : "일간 일정"}><header><span />{days.map((day) => <strong key={dateKey(day, timezone)}>{new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", month: "2-digit", day: "2-digit" }).format(day)}</strong>)}</header>{hours.map((hour) => <div className="ui037-time-row" key={hour}><time>{String(hour).padStart(2, "0")}:00</time>{days.map((day) => <section key={dateKey(day, timezone)}>{eventsForDay(visible, day, timezone).filter((item) => Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(item.starts_at))) === hour).map((item) => <EventButton key={item.id} item={item} selected={item.id === selectedId} locale={locale} timezone={timezone} onSelect={onSelect} />)}</section>)}</div>)}</section> : null}

      {!loading && !error && !empty && view === "list" ? <section className="ui037-list" aria-label="일정 목록">{visible.map((item) => <button type="button" key={item.id} className={item.id === selectedId ? "is-selected" : ""} onClick={() => onSelect(item.id)}><time>{dateTimeLabel(item.starts_at, locale, timezone)}</time><strong>{item.title}</strong><span>{timeLabel(item.ends_at, locale, timezone)} 종료</span><p>{item.description || "설명 없음"}</p></button>)}</section> : null}
    </main>

    <aside className="ui037-calendar-detail" aria-label="선택 일정 상세">
      {selected ? <><header><h2>{selected.title}</h2><div><button type="button" onClick={() => onEdit(selected)}>수정</button><button type="button" className="is-danger" onClick={onDelete}>삭제</button></div></header><dl><dt>시작</dt><dd>{dateTimeLabel(selected.starts_at, locale, timezone)}</dd><dt>종료</dt><dd>{dateTimeLabel(selected.ends_at, locale, timezone)}</dd><dt>설명</dt><dd>{selected.description || "-"}</dd></dl></> : <div className="ui037-detail-empty">일정을 선택하세요.</div>}
    </aside>
  </section>;
}
