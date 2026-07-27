import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  ApiRequestError,
  applyContactImport,
  createContactGroup,
  deleteContact,
  deleteContactGroup,
  fetchContactGroups,
  fetchContacts,
  fetchPublicContacts,
  previewContactImport,
  saveContact,
  updateContactGroup,
  type ContactGroup,
  type ContactImportPreview,
  type PublicContact,
  type WorkspaceContact,
} from "./api";
import { CommonPopup } from "./components/CommonPopup";

type Scope = "personal" | "public";
type Popup = "none" | "contact" | "group" | "delete-contact" | "delete-group" | "import";
type Props = { token: string; initialSelectionId?: string; onComposeMail: (email: string) => void };
type ContactForm = { name: string; email: string; phone: string; companyName: string; memo: string; groupId: string | null };

const emptyForm = (): ContactForm => ({ name: "", email: "", phone: "", companyName: "", memo: "", groupId: null });
const messageOf = (error: unknown) => error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "주소록 요청을 처리하지 못했습니다.";

export function AddressBookPanel({ token, initialSelectionId, onComposeMail }: Props) {
  const [scope, setScope] = useState<Scope>("personal");
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<WorkspaceContact[]>([]);
  const [publicContacts, setPublicContacts] = useState<PublicContact[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialSelectionId ?? "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [popup, setPopup] = useState<Popup>("none");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState<ContactForm>(emptyForm);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ContactImportPreview | null>(null);
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);

  const selectedPersonal = contacts.find((item) => item.id === selectedId) ?? null;
  const selectedPublic = publicContacts.find((item) => item.id === selectedId) ?? null;
  const selected = scope === "personal" ? selectedPersonal : selectedPublic;

  useEffect(() => {
    let active = true;
    void fetchContactGroups(token).then((response) => { if (active) setGroups(response.items); }).catch((cause) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [token, revision]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const request = scope === "personal" ? fetchContacts(token, query.trim(), groupId) : fetchPublicContacts(token, query.trim());
      void request.then((response) => {
        if (sequence !== requestSequence.current) return;
        const items = response.items;
        if (scope === "personal") setContacts(items as WorkspaceContact[]);
        else setPublicContacts(items as PublicContact[]);
        setSelectedId((current) => items.some((item) => item.id === initialSelectionId) ? initialSelectionId ?? "" : items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
      }).catch((cause) => { if (sequence === requestSequence.current) setError(messageOf(cause)); })
        .finally(() => { if (sequence === requestSequence.current) setLoading(false); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [groupId, initialSelectionId, query, revision, scope, token]);

  const currentGroup = useMemo(() => groups.find((item) => item.id === groupId) ?? null, [groupId, groups]);
  const refresh = (message: string) => { setNotice(message); setRevision((value) => value + 1); };

  const openContact = (contact?: WorkspaceContact) => {
    setEditingContactId(contact?.id ?? null);
    setContactForm(contact ? { name: contact.name, email: contact.email, phone: contact.phone, companyName: contact.company_name, memo: contact.memo, groupId: contact.group_id } : { ...emptyForm(), groupId });
    setError(""); setPopup("contact");
  };
  const openGroup = (group?: ContactGroup) => { setEditingGroup(group ?? null); setGroupName(group?.name ?? ""); setError(""); setPopup("group"); };

  async function submitContact(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const saved = await saveContact(token, contactForm, editingContactId ?? undefined);
      setSelectedId(saved.id); setPopup("none"); refresh("연락처를 저장했습니다.");
    } catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  }
  async function submitGroup(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const saved = editingGroup ? await updateContactGroup(token, editingGroup.id, groupName, editingGroup.updatedAt) : await createContactGroup(token, groupName);
      setGroupId(saved.id); setPopup("none"); refresh("연락처 그룹을 저장했습니다.");
    } catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  }
  async function confirmDeleteContact() {
    if (!selectedPersonal) return;
    setSaving(true); setError("");
    try { await deleteContact(token, selectedPersonal.id); setSelectedId(""); setPopup("none"); refresh("연락처를 삭제했습니다."); }
    catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  }
  async function confirmDeleteGroup() {
    if (!editingGroup) return;
    setSaving(true); setError("");
    try { await deleteContactGroup(token, editingGroup.id, editingGroup.updatedAt); setGroupId(null); setPopup("none"); refresh("그룹을 삭제하고 연락처를 미분류로 이동했습니다."); }
    catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  }
  async function previewImport() {
    if (!importFile) { setError("가져올 CSV 파일을 선택하세요."); return; }
    setSaving(true); setError("");
    try { setImportPreview(await previewContactImport(token, importFile)); }
    catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  }
  async function applyImport() {
    if (!importFile || !importPreview?.canApply) return;
    setSaving(true); setError("");
    try {
      const result = await applyContactImport(token, importFile, importPreview.digest);
      setPopup("none"); setImportFile(null); setImportPreview(null); refresh(`${result.createdCount}개 연락처를 가져왔습니다.`);
    } catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); }
  }

  const rows = scope === "personal" ? contacts : publicContacts;
  return <section className="ui041-address-book" aria-label="주소록 작업면">
    <aside className="ui041-groups" aria-label="주소록 범위와 그룹">
      <header><h2>주소록</h2><button type="button" aria-label="주소록 안내" title="개인 연락처와 회사 공용 연락처를 검색합니다.">i</button></header>
      <nav aria-label="주소록 범위"><button type="button" className={scope === "personal" ? "is-active" : ""} onClick={() => { setScope("personal"); setGroupId(null); }}>개인 주소록</button><button type="button" className={scope === "public" ? "is-active" : ""} onClick={() => { setScope("public"); setGroupId(null); }}>공용 주소록</button></nav>
      {scope === "personal" ? <section><div className="ui041-groups__title"><strong>개인 그룹</strong><button type="button" onClick={() => openGroup()}>추가</button></div><button type="button" className={groupId === null ? "is-active" : ""} onClick={() => setGroupId(null)}>전체 <span>{contacts.length}</span></button>{groups.map((group) => <div className="ui041-group-row" key={group.id}><button type="button" className={groupId === group.id ? "is-active" : ""} onClick={() => setGroupId(group.id)}>{group.name} <span>{group.contactCount}</span></button><button type="button" aria-label={`${group.name} 그룹 수정`} onClick={() => openGroup(group)}>⋯</button></div>)}</section> : <p>공용 주소록은 조회 전용입니다.</p>}
    </aside>

    <section className="ui041-list" aria-label="연락처 목록">
      <header><div><h1>{scope === "personal" ? currentGroup?.name ?? "개인 주소록" : "공용 주소록"}</h1>{scope === "personal" ? <button type="button" onClick={() => { setImportFile(null); setImportPreview(null); setPopup("import"); }}>CSV 가져오기</button> : null}</div><div><label><span className="sr-only">연락처 검색</span><input value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 이메일, 전화 검색" /></label>{scope === "personal" ? <button type="button" className="is-primary" onClick={() => openContact()}>연락처 추가</button> : null}</div></header>
      <div className="ui041-status" aria-live="polite">{error ? <span role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>재시도</button></span> : loading ? "불러오는 중입니다." : notice}</div>
      <div className="ui041-table" role="table" aria-label="연락처 검색 결과"><div role="row" className="ui041-table__head"><span role="columnheader">이름</span><span role="columnheader">이메일</span><span role="columnheader">전화/부서</span><span role="columnheader">회사/역할</span><span role="columnheader">그룹</span></div>{!loading && rows.length === 0 ? <p className="ui041-empty">표시할 연락처가 없습니다.</p> : rows.map((item) => { const personal = item as WorkspaceContact, shared = item as PublicContact; return <button role="row" type="button" key={item.id} className={selectedId === item.id ? "is-selected" : ""} onClick={() => setSelectedId(item.id)}><span role="cell">{item.name}</span><span role="cell">{item.email}</span><span role="cell">{scope === "personal" ? personal.phone || "-" : shared.department_name || "-"}</span><span role="cell">{scope === "personal" ? personal.company_name || "-" : shared.role_name || "-"}</span><span role="cell">{scope === "personal" ? personal.group_name || "미분류" : "공용"}</span></button>; })}</div>
    </section>

    <aside className="ui041-detail" aria-label="선택 연락처 상세">
      {selected ? <><header><div className="ui041-avatar" aria-hidden="true">{selected.name.slice(0, 1)}</div><h2>{selected.name}</h2><span>{scope === "personal" ? selectedPersonal?.group_name || "미분류" : "공용 연락처"}</span></header><dl><dt>이메일</dt><dd>{selected.email}</dd>{scope === "personal" ? <><dt>전화</dt><dd>{selectedPersonal?.phone || "-"}</dd><dt>회사</dt><dd>{selectedPersonal?.company_name || "-"}</dd><dt>메모</dt><dd>{selectedPersonal?.memo || "-"}</dd></> : <><dt>부서</dt><dd>{selectedPublic?.department_name || "-"}</dd><dt>역할</dt><dd>{selectedPublic?.role_name || "-"}</dd></>}</dl><div className="ui041-detail__actions"><button type="button" className="is-primary" onClick={() => onComposeMail(selected.email)}>메일 보내기</button>{selectedPersonal ? <><button type="button" onClick={() => openContact(selectedPersonal)}>수정</button><button type="button" className="is-danger" onClick={() => setPopup("delete-contact")}>삭제</button></> : null}</div></> : <p className="ui041-empty">목록에서 연락처를 선택하세요.</p>}
    </aside>

    <CommonPopup title={editingContactId ? "연락처 수정" : "연락처 추가"} open={popup === "contact"} onClose={() => setPopup("none")} saving={saving} error={error} dirty>
      <form className="ui041-form" onSubmit={submitContact}><label>이름<input required maxLength={120} value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} /></label><label>이메일<input required type="email" maxLength={255} value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></label><label>전화<input maxLength={64} value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })} /></label><label>회사<input maxLength={160} value={contactForm.companyName} onChange={(event) => setContactForm({ ...contactForm, companyName: event.target.value })} /></label><label>그룹<select value={contactForm.groupId ?? ""} onChange={(event) => setContactForm({ ...contactForm, groupId: event.target.value || null })}><option value="">미분류</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>메모<textarea maxLength={2000} value={contactForm.memo} onChange={(event) => setContactForm({ ...contactForm, memo: event.target.value })} /></label><footer><button type="button" onClick={() => setPopup("none")}>취소</button><button type="submit" className="is-primary" disabled={saving}>저장</button></footer></form>
    </CommonPopup>
    <CommonPopup title={editingGroup ? "연락처 그룹 수정" : "연락처 그룹 추가"} open={popup === "group"} onClose={() => setPopup("none")} saving={saving} error={error} dirty>
      <form className="ui041-form" onSubmit={submitGroup}><label>그룹 이름<input required maxLength={60} value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label><footer>{editingGroup ? <button type="button" className="is-danger" onClick={() => setPopup("delete-group")}>그룹 삭제</button> : <span />}<button type="submit" className="is-primary" disabled={saving}>저장</button></footer></form>
    </CommonPopup>
    <CommonPopup title="연락처 삭제" kind="alertdialog" open={popup === "delete-contact"} onClose={() => setPopup("none")} saving={saving} error={error}><p>선택한 개인 연락처를 삭제합니다.</p><div className="ui041-confirm"><button type="button" onClick={() => setPopup("none")}>취소</button><button type="button" className="is-danger" onClick={() => void confirmDeleteContact()}>삭제</button></div></CommonPopup>
    <CommonPopup title="연락처 그룹 삭제" kind="alertdialog" open={popup === "delete-group"} onClose={() => setPopup("group")} saving={saving} error={error}><p>이 그룹의 연락처 {editingGroup?.contactCount ?? 0}개는 삭제되지 않고 미분류로 이동합니다.</p><div className="ui041-confirm"><button type="button" onClick={() => setPopup("group")}>취소</button><button type="button" className="is-danger" onClick={() => void confirmDeleteGroup()}>그룹 삭제</button></div></CommonPopup>
    <CommonPopup title="CSV 연락처 가져오기" open={popup === "import"} onClose={() => setPopup("none")} saving={saving} error={error} dirty={Boolean(importFile)}><section className="ui041-import"><label>UTF-8 CSV 파일<input type="file" accept=".csv,text/csv" onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setImportPreview(null); }} /></label><button type="button" onClick={() => void previewImport()} disabled={!importFile || saving}>미리보기</button>{importPreview ? <div><strong>{importPreview.canApply ? "적용할 수 있습니다." : "오류 행을 수정하세요."}</strong><dl><dt>신규</dt><dd>{importPreview.newCount}</dd><dt>기존 중복</dt><dd>{importPreview.existingEmailCount}</dd><dt>파일 중복</dt><dd>{importPreview.fileDuplicateCount}</dd><dt>생성 그룹</dt><dd>{importPreview.groupsToCreate.join(", ") || "없음"}</dd></dl>{importPreview.errors.map((item) => <p role="alert" key={`${item.rowNumber}-${item.message}`}>{item.rowNumber}행: {item.message}</p>)}<button type="button" className="is-primary" disabled={!importPreview.canApply || saving} onClick={() => void applyImport()}>가져오기 적용</button></div> : null}</section></CommonPopup>
  </section>;
}
