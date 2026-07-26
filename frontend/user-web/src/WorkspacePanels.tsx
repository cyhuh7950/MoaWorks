import React, { FormEvent, useEffect, useRef, useState } from "react";

import { CalendarPanel } from "./CalendarPanel";

import {
  ApiRequestError,
  deleteContact,
  deleteSchedule,
  deleteWorkspaceFile,
  fetchContacts,
  fetchSchedules,
  fetchWorkspaceDirectory,
  fetchWorkspaceFiles,
  fetchWorkspaceHelpPolicies,
  fetchWorkspacePreferences,
  renameWorkspaceFile,
  saveContact,
  saveSchedule,
  saveWorkspacePreferences,
  uploadWorkspaceFile,
  type WorkspaceContact,
  type WorkspaceDirectory,
  type WorkspaceFile,
  type WorkspaceHelpPolicy,
  type WorkspaceSchedule,
} from "./api";

type WorkspaceMenu = "schedule" | "contacts" | "org" | "files" | "settings" | "help";
type ModalMode = "none" | "schedule" | "contact" | "file" | "settings" | "confirm-delete";

type Props = {
  menu: WorkspaceMenu;
  token: string;
  locale: string;
  timezone: string;
  initialSelectionId?: string;
  onPreferencesSaved: (locale: string, timezone: string) => void;
};

const panelStyle = { borderRadius: 18, padding: 16, background: "#fff", border: "1px solid #dbe4ec", minHeight: 0, overflow: "auto" } as const;
const buttonStyle = { height: 36, borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", padding: "0 12px", cursor: "pointer" } as const;
const primaryButtonStyle = { ...buttonStyle, border: 0, color: "#fff", background: "#0f766e", fontWeight: 700 } as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function toInputDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
}

function WorkspaceModal({ title, children, showScheduleError, error, onClose }: { title: string; children: React.ReactNode; showScheduleError: boolean; error: string; onClose: () => void }) {
  return <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(15,23,42,.42)", display: "grid", placeItems: "center", padding: 24 }}><section style={{ width: "min(640px, 100%)", maxHeight: "min(760px, calc(100vh - 48px))", overflow: "auto", borderRadius: 18, padding: 20, background: "#fff", boxShadow: "0 24px 64px rgba(15,23,42,.28)" }}><header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2><button type="button" onClick={onClose} style={buttonStyle}>{"\uB2EB\uAE30"}</button></header>{showScheduleError && error ? <div role="alert" style={{ marginBottom: 12, color: "#b91c1c", fontSize: 12 }}>{error}</div> : null}{children}</section></div>;
}

export function WorkspacePanels({ menu, token, locale, timezone, initialSelectionId, onPreferencesSaved }: Props) {
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [contacts, setContacts] = useState<WorkspaceContact[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [directory, setDirectory] = useState<WorkspaceDirectory>({ departments: [], users: [] });
  const [helpPolicies, setHelpPolicies] = useState<WorkspaceHelpPolicy[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [modal, setModal] = useState<ModalMode>("none");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduleForm, setScheduleForm] = useState({ title: "", startsAt: "", endsAt: "", description: "" });
  const [scheduleEditingId, setScheduleEditingId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "", companyName: "", memo: "" });
  const [fileName, setFileName] = useState("");
  const fileUploadRef = useRef<File | null>(null);
  const [preferenceForm, setPreferenceForm] = useState({ locale, timezone });
  const [contactEditingId, setContactEditingId] = useState<string | null>(null);
  const [fileEditingId, setFileEditingId] = useState<string | null>(null);

  const selectedSchedule = schedules.find((item) => item.id === selectedId) ?? null;
  const selectedContact = contacts.find((item) => item.id === selectedId) ?? null;
  const selectedFile = files.find((item) => item.id === selectedId) ?? null;
  const selectedHelp = helpPolicies.find((item) => item.id === selectedId) ?? null;
  const selectedMember = directory.users.find((item) => item.id === selectedId) ?? null;

  async function refresh(): Promise<void> {
    setError("");
    if (menu === "schedule") {
      setScheduleLoading(true);
      setScheduleError("");
    }
    try {
      if (menu === "schedule") {
        const response = await fetchSchedules(token);
        setSchedules(response.items);
        setSelectedId((current) => response.items.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.items.some((item) => item.id === current) ? current : "");
      } else if (menu === "contacts") {
        const response = await fetchContacts(token);
        setContacts(response.items);
        setSelectedId((current) => response.items.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? "");
      } else if (menu === "files") {
        const response = await fetchWorkspaceFiles(token);
        setFiles(response.items);
        setSelectedId((current) => response.items.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? "");
      } else if (menu === "org") {
        const response = await fetchWorkspaceDirectory(token);
        setDirectory(response);
        setSelectedDepartmentId((current) => response.departments.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.departments.some((item) => item.id === current) ? current : response.departments[0]?.id ?? "");
        setSelectedId((current) => response.users.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : response.users.some((item) => item.id === current) ? current : response.users[0]?.id ?? "");
      } else if (menu === "settings") {
        const response = await fetchWorkspacePreferences(token);
        setPreferenceForm(response);
      } else if (menu === "help") {
        const response = await fetchWorkspaceHelpPolicies(token);
        setHelpPolicies(response.items);
        setSelectedId((current) => response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? "");
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
    setNotice(""); setError("");
    setScheduleForm(item ? { title: item.title, startsAt: toInputDate(item.starts_at), endsAt: toInputDate(item.ends_at), description: item.description } : { title: "", startsAt: "", endsAt: "", description: "" });
    if (item) setSelectedId(item.id);
    setScheduleEditingId(item?.id ?? null); setModal("schedule");
  }
  function openContact(item?: WorkspaceContact) {
    setNotice(""); setError("");
    setContactForm(item ? { name: item.name, email: item.email, phone: item.phone, companyName: item.company_name, memo: item.memo } : { name: "", email: "", phone: "", companyName: "", memo: "" });
    setSelectedId(item?.id ?? ""); setContactEditingId(item?.id ?? null); setModal("contact");
  }
  async function submitSchedule(event: FormEvent) {
    event.preventDefault();
    try { setError(""); const saved = await saveSchedule(token, { ...scheduleForm, startsAt: new Date(scheduleForm.startsAt).toISOString(), endsAt: new Date(scheduleForm.endsAt).toISOString() }, scheduleEditingId ?? undefined); setSelectedId(saved.id); setError(""); setNotice("일정을 저장했습니다."); setModal("none"); await refresh(); }
    catch (cause) { setError(cause instanceof ApiRequestError ? cause.message : "일정 저장 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
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
  async function submitPreferences(event: FormEvent) {
    event.preventDefault();
    try { const saved = await saveWorkspacePreferences(token, preferenceForm); onPreferencesSaved(saved.locale, saved.timezone); setNotice("설정을 저장했습니다."); setModal("none"); await refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
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
  if (menu === "schedule") view = <CalendarPanel schedules={schedules} selectedId={selectedId} locale={locale} timezone={timezone} loading={scheduleLoading} error={scheduleError} onRetry={() => void refresh()} onCreate={() => openSchedule()} onSelect={setSelectedId} onEdit={openSchedule} onDelete={() => setModal("confirm-delete")} />;
  else if (menu === "contacts") view = <section style={{ display: "grid", gridTemplateColumns: "minmax(280px,.8fr) minmax(420px,1.2fr)", gap: 16, minHeight: 0, height: "100%" }}><article style={panelStyle}><header style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 22 }}>개인 주소록</h2><button type="button" onClick={() => openContact()} style={primaryButtonStyle}>연락처 추가</button></header><div style={{ marginTop: 12, display: "grid", gap: 6 }}>{contacts.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} onDoubleClick={() => openContact(item)} style={{ ...buttonStyle, height: "auto", minHeight: 54, textAlign: "left", background: selectedId === item.id ? "#e6fffb" : "#fff" }}><strong>{item.name}</strong><div style={{ color: "#64748b", marginTop: 4 }}>{item.email}</div></button>)}</div></article>{selectedContact ? detail(selectedContact.name, [["이메일", selectedContact.email], ["전화", selectedContact.phone], ["회사", selectedContact.company_name], ["메모", selectedContact.memo]], () => openContact(selectedContact), () => setModal("confirm-delete")) : detail("선택 연락처", [["안내", "개인 연락처를 선택하거나 추가하세요."]])}</section>;
  else if (menu === "org") view = <section style={{ display: "grid", gridTemplateColumns: "minmax(280px,.8fr) minmax(420px,1.2fr)", gap: 16, minHeight: 0, height: "100%" }}><article style={panelStyle}><h2 style={{ margin: 0, fontSize: 22 }}>조직도</h2><div style={{ marginTop: 12, display: "grid", gap: 8 }}>{directory.departments.map((department) => <section key={department.id} style={{ border: "1px solid #dbe4ec", borderRadius: 12, padding: 10 }}><strong>{department.name}</strong><div style={{ marginTop: 8, display: "grid", gap: 4 }}>{directory.users.filter((user) => user.department_name === department.name).map((user) => <button type="button" key={user.id} onClick={() => setSelectedId(user.id)} style={{ ...buttonStyle, textAlign: "left", background: selectedId === user.id ? "#e6fffb" : "#fff" }}>{user.name}</button>)}</div></section>)}</div></article>{selectedMember ? detail(selectedMember.name, [["이메일", selectedMember.email], ["부서", selectedMember.department_name], ["역할", selectedMember.role_name]]) : detail("조직 사용자", [["안내", "조직 정보는 조회 전용이며 변경은 관리자 콘솔에서 처리합니다."]])}</section>;
  else if (menu === "files") view = <section style={{ display: "grid", gridTemplateColumns: "minmax(280px,.8fr) minmax(420px,1.2fr)", gap: 16, minHeight: 0, height: "100%" }}><article style={panelStyle}><header style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 22 }}>파일</h2><button type="button" onClick={() => { setSelectedId(""); setFileEditingId(null); fileUploadRef.current = null; setModal("file"); }} style={primaryButtonStyle}>업로드</button></header><div style={{ marginTop: 12, display: "grid", gap: 6 }}>{files.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} onDoubleClick={() => { setSelectedId(item.id); setFileEditingId(item.id); setFileName(item.file_name); setModal("file"); }} style={{ ...buttonStyle, height: "auto", minHeight: 54, textAlign: "left", background: selectedId === item.id ? "#e6fffb" : "#fff" }}><strong>{item.file_name}</strong><div style={{ color: "#64748b", marginTop: 4 }}>{item.size_bytes} bytes / {formatDate(item.updated_at)}</div></button>)}</div></article>{selectedFile ? detail(selectedFile.file_name, [["형식", selectedFile.content_type], ["크기", `${selectedFile.size_bytes} bytes`], ["수정", formatDate(selectedFile.updated_at)]], () => { setFileEditingId(selectedFile.id); setFileName(selectedFile.file_name); setModal("file"); }, () => setModal("confirm-delete")) : detail("선택 파일", [["안내", "파일을 선택하거나 업로드하세요."]])}</section>;
  else if (menu === "settings") view = <section style={{ display: "grid", gridTemplateColumns: "minmax(300px,.9fr) minmax(420px,1.1fr)", gap: 16, minHeight: 0, height: "100%" }}><article style={panelStyle}><h2 style={{ margin: 0, fontSize: 22 }}>내 설정</h2><dl style={{ margin: "18px 0", display: "grid", gridTemplateColumns: "100px 1fr", gap: 10, fontSize: 12 }}><dt>언어</dt><dd style={{ margin: 0 }}>{preferenceForm.locale}</dd><dt>시간대</dt><dd style={{ margin: 0 }}>{preferenceForm.timezone}</dd></dl><button type="button" onClick={() => setModal("settings")} style={primaryButtonStyle}>설정 변경</button></article><article style={panelStyle}><h2 style={{ margin: 0, fontSize: 22 }}>화면 적용</h2><p style={{ fontSize: 12, color: "#475569" }}>언어와 시간대는 사용자 계정에 저장되며 다시 로그인해도 같은 값으로 조회됩니다.</p></article></section>;
  else view = <section style={{ display: "grid", gridTemplateColumns: "minmax(280px,.8fr) minmax(420px,1.2fr)", gap: 16, minHeight: 0, height: "100%" }}><article style={panelStyle}><h2 style={{ margin: 0, fontSize: 22 }}>Help / 정책</h2><div style={{ marginTop: 12, display: "grid", gap: 6 }}>{helpPolicies.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} style={{ ...buttonStyle, height: "auto", minHeight: 50, textAlign: "left", background: selectedId === item.id ? "#e6fffb" : "#fff" }}><strong>{item.title}</strong><div style={{ color: "#64748b", marginTop: 4 }}>{item.category}</div></button>)}</div></article>{selectedHelp ? detail(selectedHelp.title, [["분류", selectedHelp.category], ["본문", selectedHelp.content]]) : detail("문서 선택", [["안내", "공개된 도움말과 정책 문서를 선택하세요."]])}</section>;

  return <section style={{ minHeight: 0, height: "100%", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", gap: 8 }}><div style={{ minHeight: 20, fontSize: 12, color: error ? "#b91c1c" : "#0f766e" }}>{error || notice}</div>{view}{modal === "none" ? null : <WorkspaceModal title={modal === "schedule" ? (scheduleEditingId ? "일정 수정" : "일정 만들기") : modal === "contact" ? (selectedContact ? "연락처 수정" : "연락처 추가") : modal === "file" ? (fileEditingId ? "파일 이름 변경" : "파일 업로드") : modal === "settings" ? "내 설정 변경" : "삭제 확인"} showScheduleError={modal === "schedule"} error={error} onClose={() => setModal("none")}>{modal === "schedule" ? <form onSubmit={submitSchedule} style={{ display: "grid", gap: 10 }}><input required value={scheduleForm.title} onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })} placeholder="일정 제목"/><input required type="datetime-local" value={scheduleForm.startsAt} onChange={(e) => setScheduleForm({ ...scheduleForm, startsAt: e.target.value })}/><input required type="datetime-local" value={scheduleForm.endsAt} onChange={(e) => setScheduleForm({ ...scheduleForm, endsAt: e.target.value })}/><textarea value={scheduleForm.description} onChange={(e) => setScheduleForm({ ...scheduleForm, description: e.target.value })} placeholder="메모"/><button style={primaryButtonStyle}>저장</button></form> : null}{modal === "contact" ? <form onSubmit={submitContact} style={{ display: "grid", gap: 10 }}><input required value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="이름"/><input required type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} placeholder="이메일"/><input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="전화"/><input value={contactForm.companyName} onChange={(e) => setContactForm({ ...contactForm, companyName: e.target.value })} placeholder="회사"/><textarea value={contactForm.memo} onChange={(e) => setContactForm({ ...contactForm, memo: e.target.value })} placeholder="메모"/><button style={primaryButtonStyle}>저장</button></form> : null}{modal === "file" ? <form onSubmit={submitFile} style={{ display: "grid", gap: 10 }}>{fileEditingId ? <input required value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="파일 이름"/> : <input required type="file" onChange={(e) => fileUploadRef.current = e.target.files?.[0] ?? null}/>}<button style={primaryButtonStyle}>{fileEditingId ? "이름 저장" : "업로드"}</button></form> : null}{modal === "settings" ? <form onSubmit={submitPreferences} style={{ display: "grid", gap: 10 }}><select value={preferenceForm.locale} onChange={(e) => setPreferenceForm({ ...preferenceForm, locale: e.target.value })}><option value="ko">ko</option><option value="en">en</option><option value="ja">ja</option></select><input value={preferenceForm.timezone} onChange={(e) => setPreferenceForm({ ...preferenceForm, timezone: e.target.value })}/><button style={primaryButtonStyle}>저장</button></form> : null}{modal === "confirm-delete" ? <><p style={{ fontSize: 12 }}>선택 항목을 삭제 상태로 변경합니다.</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" onClick={() => setModal("none")} style={buttonStyle}>취소</button><button type="button" onClick={() => void confirmDelete()} style={{ ...primaryButtonStyle, background: "#9f1239" }}>삭제</button></div></> : null}</WorkspaceModal>}</section>;
}
