import React, { FormEvent, useEffect, useRef, useState } from "react";

import { AddressBookPanel } from "./AddressBookPanel";
import { CalendarPanel } from "./CalendarPanel";
import { OrganizationPanel } from "./OrganizationPanel";
import { ScheduleComposePopup } from "./ScheduleComposePopup";
import { FilePanel } from "./FilePanel";
import { SettingsHelpPanel } from "./SettingsHelpPanel";
import { createScheduleDraft, type ScheduleDraft } from "./scheduleForm";

import {
  ApiRequestError,
  deleteContact,
  deleteSchedule,
  deleteWorkspaceFile,
  fetchContacts,
  fetchCalendars,
  fetchSchedules,
  fetchWorkspaceDirectory,
  fetchWorkspaceFiles,
  renameWorkspaceFile,
  saveContact,
  saveSchedule,
  uploadWorkspaceFile,
  type WorkspaceContact,
  type WorkspaceCalendarData,
  type WorkspaceDirectory,
  type WorkspaceFile,
  type WorkspaceSchedule,
} from "./api";

type WorkspaceMenu = "schedule" | "contacts" | "org" | "files" | "settings" | "help";
type ModalMode = "none" | "contact" | "file" | "confirm-delete";

type Props = {
  menu: WorkspaceMenu;
  token: string;
  locale: string;
  timezone: string;
  ownerUserId: string;
  initialSelectionId?: string;
  onPreferencesSaved: (locale: string, timezone: string) => void;
  onProfileSaved: () => void;
  onComposeMail: (email: string) => void;
  onOpenWorkspaceSettings: (target: "mail" | "approval" | "calendar") => void;
  calendarSettingsRequestKey: number;
  translationTool?: React.ReactNode;
};

const panelStyle = { borderRadius: 18, padding: 16, background: "#fff", border: "1px solid #dbe4ec", minHeight: 0, overflow: "auto" } as const;
const buttonStyle = { height: 36, borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", padding: "0 12px", cursor: "pointer" } as const;
const primaryButtonStyle = { ...buttonStyle, border: 0, color: "#fff", background: "#0f766e", fontWeight: 700 } as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
}

function WorkspaceModal({ title, children, showScheduleError, error, onClose }: { title: string; children: React.ReactNode; showScheduleError: boolean; error: string; onClose: () => void }) {
  return <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(15,23,42,.42)", display: "grid", placeItems: "center", padding: 24 }}><section style={{ width: "min(640px, 100%)", maxHeight: "min(760px, calc(100vh - 48px))", overflow: "auto", borderRadius: 18, padding: 20, background: "#fff", boxShadow: "0 24px 64px rgba(15,23,42,.28)" }}><header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2><button type="button" onClick={onClose} style={buttonStyle}>{"\uB2EB\uAE30"}</button></header>{showScheduleError && error ? <div role="alert" style={{ marginBottom: 12, color: "#b91c1c", fontSize: 12 }}>{error}</div> : null}{children}</section></div>;
}

export function WorkspacePanels({ menu, token, locale, timezone, ownerUserId, initialSelectionId, onPreferencesSaved, onProfileSaved, onComposeMail, onOpenWorkspaceSettings, calendarSettingsRequestKey, translationTool }: Props) {
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [calendarData, setCalendarData] = useState<WorkspaceCalendarData>({ owned: [], subscriptions: [], incomingRequests: [] });
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [contacts, setContacts] = useState<WorkspaceContact[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [directory, setDirectory] = useState<WorkspaceDirectory>({ departments: [], users: [] });
  const [selectedId, setSelectedId] = useState("");
  const [modal, setModal] = useState<ModalMode>("none");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => createScheduleDraft(null, timezone));
  const [schedulePopupOpen, setSchedulePopupOpen] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [schedulePopupError, setSchedulePopupError] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "", companyName: "", memo: "" });
  const [fileName, setFileName] = useState("");
  const fileUploadRef = useRef<File | null>(null);
  const [contactEditingId, setContactEditingId] = useState<string | null>(null);
  const [fileEditingId, setFileEditingId] = useState<string | null>(null);

  const selectedSchedule = schedules.find((item) => item.id === selectedId) ?? null;
  const selectedContact = contacts.find((item) => item.id === selectedId) ?? null;
  const selectedFile = files.find((item) => item.id === selectedId) ?? null;
  const defaultCalendar = calendarData.owned.find((item) => item.isDefault) ?? calendarData.owned[0];

  async function refresh(): Promise<void> {
    setError("");
    if (menu === "schedule") {
      setScheduleLoading(true);
      setScheduleError("");
    }
    try {
      if (menu === "schedule") {
        const [response, directoryResponse, calendarResponse] = await Promise.all([fetchSchedules(token), fetchWorkspaceDirectory(token), fetchCalendars(token)]);
        setSchedules(response.items);
        setDirectory(directoryResponse);
        setCalendarData(calendarResponse);
        setSelectedId((current) => response.items.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.items.some((item) => item.id === current) ? current : "");
      } else if (menu === "contacts") {
        setSelectedId(initialSelectionId ?? "");
      } else if (menu === "files") {
        const response = await fetchWorkspaceFiles(token);
        setFiles(response.items);
        setSelectedId((current) => response.items.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? "");
      }
    } catch (cause) {
      const message = errorMessage(cause);
      if (menu === "schedule") setScheduleError(message);
      else setError(message);
    } finally {
      if (menu === "schedule") setScheduleLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [menu, token, initialSelectionId]);

  function openSchedule(item?: WorkspaceSchedule) {
    setNotice(""); setError(""); setSchedulePopupError("");
    setScheduleDraft(createScheduleDraft(item ?? null, timezone, new Date(), item?.calendarId ?? defaultCalendar?.id ?? ""));
    if (item) setSelectedId(item.id);
    setSchedulePopupOpen(true);
  }
  function openContact(item?: WorkspaceContact) {
    setNotice(""); setError("");
    setContactForm(item ? { name: item.name, email: item.email, phone: item.phone, companyName: item.company_name, memo: item.memo } : { name: "", email: "", phone: "", companyName: "", memo: "" });
    setSelectedId(item?.id ?? ""); setContactEditingId(item?.id ?? null); setModal("contact");
  }
  async function submitSchedule(payload: Parameters<typeof saveSchedule>[1], scheduleId: string | null) {
    setScheduleSaving(true);
    try { setSchedulePopupError(""); const saved = await saveSchedule(token, payload, scheduleId ?? undefined); setSelectedId(saved.id); setNotice("일정을 저장했습니다."); setSchedulePopupOpen(false); await refresh(); }
    catch (cause) { const message = cause instanceof ApiRequestError ? cause.message : "일정 저장 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."; setSchedulePopupError(message); throw new Error(message); }
    finally { setScheduleSaving(false); }
  }
  async function submitContact(event: FormEvent) {
    event.preventDefault();
    try { await saveContact(token, contactForm, contactEditingId ?? undefined); setNotice("연락처를 저장했습니다."); setModal("none"); await refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  async function submitFile(event: FormEvent) {
    event.preventDefault();
    try {
      if (fileEditingId) await renameWorkspaceFile(token, fileEditingId, fileName);
      else if (fileUploadRef.current) await uploadWorkspaceFile(token, fileUploadRef.current);
      else throw new Error("업로드할 파일을 선택하세요.");
      setNotice(fileEditingId ? "파일 이름을 변경했습니다." : "파일을 업로드했습니다."); setModal("none"); await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function confirmDelete() {
    try {
      if (menu === "schedule" && selectedSchedule) await deleteSchedule(token, selectedSchedule.id);
      if (menu === "contacts" && selectedContact) await deleteContact(token, selectedContact.id);
      if (menu === "files" && selectedFile) await deleteWorkspaceFile(token, selectedFile.id);
      setNotice("선택 항목을 삭제했습니다."); setModal("none"); await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const List = ({ children }: { children: React.ReactNode }) => <section style={{ display: "grid", gridTemplateColumns: "minmax(280px, .8fr) minmax(420px, 1.2fr)", gap: 16, minHeight: 0, height: "100%" }}><article style={panelStyle}>{children}</article></section>;
  const detail = (title: string, lines: Array<[string, string]>, onEdit?: () => void, onDelete?: () => void) => <article style={panelStyle}><header style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2><div style={{ display: "flex", gap: 8 }}>{onEdit ? <button type="button" onClick={onEdit} style={buttonStyle}>수정</button> : null}{onDelete ? <button type="button" onClick={() => setModal("confirm-delete")} style={{ ...buttonStyle, color: "#9f1239" }}>삭제</button> : null}</div></header><dl style={{ margin: "18px 0 0", display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px 14px", fontSize: 12 }}>{lines.map(([key, value]) => <><dt key={`${key}-k`} style={{ color: "#64748b" }}>{key}</dt><dd key={`${key}-v`} style={{ margin: 0, whiteSpace: "pre-wrap" }}>{value || "-"}</dd></>)}</dl></article>;

  let view: React.ReactNode;
  if (menu === "schedule") view = <CalendarPanel schedules={schedules} selectedId={selectedId} locale={locale} timezone={timezone} loading={scheduleLoading} error={scheduleError} token={token} ownerUserId={ownerUserId} calendarData={calendarData} settingsRequestKey={calendarSettingsRequestKey} onCalendarsChanged={refresh} onRetry={() => void refresh()} onCreate={() => openSchedule()} onSelect={setSelectedId} onEdit={openSchedule} onDelete={() => setModal("confirm-delete")} />;
  else if (menu === "contacts") view = <AddressBookPanel token={token} initialSelectionId={initialSelectionId} onComposeMail={onComposeMail} />;
  else if (menu === "org") view = <OrganizationPanel token={token} initialSelectionId={initialSelectionId} onComposeMail={onComposeMail} />;
  else if (menu === "files") view = <FilePanel token={token} currentUserId={ownerUserId} initialSelectionId={initialSelectionId} />;
  else view = <SettingsHelpPanel mode={menu === "settings" ? "settings" : "help"} token={token} onPreferencesSaved={onPreferencesSaved} onProfileSaved={onProfileSaved} onOpenWorkspaceSettings={onOpenWorkspaceSettings} translationTool={translationTool} />;

  const modalTitle = modal === "contact" ? (selectedContact ? "연락처 수정" : "연락처 추가") : modal === "file" ? (fileEditingId ? "파일 이름 변경" : "파일 업로드") : "삭제 확인";
  return <section style={{ minHeight: 0, height: "100%", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", gap: 8 }}>
    <div style={{ minHeight: 20, fontSize: 12, color: error ? "#b91c1c" : "#0f766e" }}>{error || notice}</div>
    {view}
    <ScheduleComposePopup open={schedulePopupOpen} draft={scheduleDraft} users={directory.users} ownerUserId={ownerUserId} ownedCalendars={calendarData.owned} saving={scheduleSaving} error={schedulePopupError} onClose={() => setSchedulePopupOpen(false)} onSave={submitSchedule} />
    {modal === "none" ? null : <WorkspaceModal title={modalTitle} showScheduleError={false} error={error} onClose={() => setModal("none")}>
      {modal === "contact" ? <form onSubmit={submitContact} style={{ display: "grid", gap: 10 }}><input required value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="이름"/><input required type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} placeholder="이메일"/><input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="전화"/><input value={contactForm.companyName} onChange={(e) => setContactForm({ ...contactForm, companyName: e.target.value })} placeholder="회사"/><textarea value={contactForm.memo} onChange={(e) => setContactForm({ ...contactForm, memo: e.target.value })} placeholder="메모"/><button style={primaryButtonStyle}>저장</button></form> : null}
      {modal === "file" ? <form onSubmit={submitFile} style={{ display: "grid", gap: 10 }}>{fileEditingId ? <input required value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="파일 이름"/> : <input required type="file" onChange={(e) => fileUploadRef.current = e.target.files?.[0] ?? null}/>}<button style={primaryButtonStyle}>{fileEditingId ? "이름 저장" : "업로드"}</button></form> : null}
      {modal === "confirm-delete" ? <><p style={{ fontSize: 12 }}>선택 항목을 삭제 상태로 변경합니다.</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" onClick={() => setModal("none")} style={buttonStyle}>취소</button><button type="button" onClick={() => void confirmDelete()} style={{ ...primaryButtonStyle, background: "#9f1239" }}>삭제</button></div></> : null}
    </WorkspaceModal>}
  </section>;
}
