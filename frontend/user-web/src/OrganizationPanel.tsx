import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiRequestError,
  fetchOrganizationDepartments,
  fetchOrganizationMemberDetail,
  fetchOrganizationMembers,
  type OrganizationDepartment,
  type OrganizationMember,
} from "./api";

type Props = { token: string; initialSelectionId?: string; onComposeMail: (email: string) => void };
type TreeRow = { department: OrganizationDepartment; depth: number };

function message(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "조직 정보를 불러오지 못했습니다.";
}

function flattenDepartments(departments: OrganizationDepartment[], expandedDepartmentIds: Set<string>): TreeRow[] {
  const byId = new Map(departments.map((department) => [department.id, department]));
  const children = new Map<string, OrganizationDepartment[]>();
  for (const department of departments) {
    const parentId = department.parentId && department.parentId !== department.id && byId.has(department.parentId) ? department.parentId : "";
    children.set(parentId, [...(children.get(parentId) ?? []), department]);
  }
  for (const values of children.values()) values.sort((left, right) => left.name.localeCompare(right.name, "ko") || left.id.localeCompare(right.id));
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const visit = (department: OrganizationDepartment, depth: number) => {
    if (visited.has(department.id)) return;
    visited.add(department.id);
    rows.push({ department, depth });
    if (expandedDepartmentIds.has(department.id)) for (const child of children.get(department.id) ?? []) visit(child, depth + 1);
  };
  for (const root of children.get("") ?? []) visit(root, 0);
  for (const department of departments) if (!visited.has(department.id)) visit(department, 0);
  return rows;
}

export function OrganizationPanel({ token, initialSelectionId, onComposeMail }: Props) {
  const [departments, setDepartments] = useState<OrganizationDepartment[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [detail, setDetail] = useState<OrganizationMember | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(initialSelectionId ?? "");
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [departmentsError, setDepartmentsError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupDepartmentId, setPopupDepartmentId] = useState("");
  const [popupQuery, setPopupQuery] = useState("");
  const [popupMembers, setPopupMembers] = useState<OrganizationMember[]>([]);
  const [popupSelectionId, setPopupSelectionId] = useState("");
  const [popupError, setPopupError] = useState("");
  const [popupLoading, setPopupLoading] = useState(false);
  const [membersReloadKey, setMembersReloadKey] = useState(0);
  const [popupReloadKey, setPopupReloadKey] = useState(0);
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const popupRequestSequence = useRef(0);
  const selectedMemberIdRef = useRef(initialSelectionId ?? "");
  const initialDetailPendingRef = useRef(Boolean(initialSelectionId));
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  async function loadDepartments() {
    setDepartmentsLoading(true); setDepartmentsError("");
    try {
      const response = await fetchOrganizationDepartments(token);
      setDepartments(response.departments);
      setExpandedDepartmentIds(new Set(response.departments.map((department) => department.id)));
    } catch (cause) { setDepartmentsError(message(cause)); }
    finally { setDepartmentsLoading(false); }
  }

  useEffect(() => { void loadDepartments(); }, [token]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setMembersLoading(true); setMembersError("");
    void fetchOrganizationMembers(token, { departmentId: selectedDepartmentId || undefined, query: debouncedQuery || undefined })
      .then((response) => {
        if (sequence !== requestSequence.current) return;
        const members = response.members;
        setMembers(members);
        const currentSelectionId = selectedMemberIdRef.current;
        if (currentSelectionId && !members.some((member) => member.id === currentSelectionId) && !initialDetailPendingRef.current) {
          selectedMemberIdRef.current = "";
          setSelectedMemberId("");
          setDetail(null);
          setDetailError("");
          ++detailRequestSequence.current;
          setDetailLoading(false);
        }
      })
      .catch((cause) => { if (sequence === requestSequence.current) setMembersError(message(cause)); })
      .finally(() => { if (sequence === requestSequence.current) setMembersLoading(false); });
  }, [token, selectedDepartmentId, debouncedQuery, membersReloadKey]);

  async function selectMember(userId: string, initial = false) {
    const sequence = ++detailRequestSequence.current;
    selectedMemberIdRef.current = userId;
    if (initial) initialDetailPendingRef.current = true;
    setSelectedMemberId(userId); setDetailLoading(true); setDetailError("");
    try {
      const response = await fetchOrganizationMemberDetail(token, userId);
      if (sequence === detailRequestSequence.current) setDetail(response);
    } catch (cause) {
      if (sequence === detailRequestSequence.current) { setDetail(null); setDetailError(message(cause)); }
    } finally {
      if (initial) initialDetailPendingRef.current = false;
      if (sequence === detailRequestSequence.current) {
        setDetailLoading(false);
      }
    }
  }

  useEffect(() => { if (initialSelectionId) void selectMember(initialSelectionId, true); }, [initialSelectionId, token]);
  const treeRows = useMemo(() => flattenDepartments(departments, expandedDepartmentIds), [departments, expandedDepartmentIds]);

  function closePopup() {
    ++popupRequestSequence.current;
    setPopupLoading(false);
    setPopupOpen(false);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }
  useEffect(() => { if (popupOpen) window.setTimeout(() => dialogRef.current?.focus(), 0); }, [popupOpen]);
  useEffect(() => {
    if (!popupOpen) return;
    const timer = window.setTimeout(() => {
      const sequence = ++popupRequestSequence.current;
      setPopupLoading(true);
      setPopupError("");
      void fetchOrganizationMembers(token, { departmentId: popupDepartmentId || undefined, query: popupQuery.trim() || undefined })
        .then((response) => { if (sequence === popupRequestSequence.current) setPopupMembers(response.members); })
        .catch((cause) => { if (sequence === popupRequestSequence.current) setPopupError(message(cause)); })
        .finally(() => { if (sequence === popupRequestSequence.current) setPopupLoading(false); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [popupOpen, popupDepartmentId, popupQuery, popupReloadKey, token]);

  const membersEmpty = !membersLoading && !membersError && members.length === 0;
  const popupEmpty = !popupLoading && !popupError && popupMembers.length === 0;
  return <section className="ui042-organization">
    <header className="ui042-header"><div><h1 className="ui042-screen-title">조직도</h1><p>부서와 구성원을 조회하고 메일을 작성할 수 있습니다.</p></div><button ref={returnFocusRef} type="button" onClick={() => { setPopupSelectionId(selectedMemberId); setPopupOpen(true); }}>구성원 선택</button></header>
    <div className="ui042-workspace">
      <article className="ui042-departments"><h2 className="ui042-section-title">부서</h2><button className={!selectedDepartmentId ? "is-selected" : ""} type="button" onClick={() => setSelectedDepartmentId("")}>전체 구성원</button>{departmentsLoading ? <p className="ui042-state">loading · 부서를 불러오는 중...</p> : departmentsError ? <div className="ui042-state is-error"><p>{departmentsError}</p><button type="button" onClick={() => void loadDepartments()}>다시 시도</button></div> : departments.length === 0 ? <p className="ui042-state">empty · 표시할 부서가 없습니다.</p> : <div className="ui042-scroll">{treeRows.map(({ department, depth }) => <div className="ui042-tree-row" key={department.id} style={{ paddingLeft: depth * 14 }}><button type="button" aria-label={`${department.name} 펼침 전환`} onClick={() => setExpandedDepartmentIds((current) => { const next = new Set(current); next.has(department.id) ? next.delete(department.id) : next.add(department.id); return next; })}>{expandedDepartmentIds.has(department.id) ? "−" : "+"}</button><button className={selectedDepartmentId === department.id ? "is-selected" : ""} type="button" onClick={() => setSelectedDepartmentId(department.id)}><span>{department.name}</span><small>{department.directMemberCount}</small></button></div>)}</div>}</article>
      <article className="ui042-members"><h2 className="ui042-section-title">구성원</h2><label>이름 또는 이메일 검색<input value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="검색어 입력" /></label>{membersLoading ? <p className="ui042-state">loading · 구성원을 불러오는 중...</p> : membersError ? <div className="ui042-state is-error"><p>{membersError}</p><button type="button" onClick={() => setMembersReloadKey((current) => current + 1)}>다시 시도</button></div> : membersEmpty ? <p className="ui042-state">empty · 표시할 구성원이 없습니다.</p> : <div className="ui042-scroll">{members.map((member) => <button className={selectedMemberId === member.id ? "ui042-member is-selected" : "ui042-member"} type="button" key={member.id} onClick={() => void selectMember(member.id)}><span className="ui042-member__name">{member.name}</span><span className="ui042-member__department">{member.departmentName || "미지정"}</span><span className="ui042-member__role">{member.roleName}</span><span className="ui042-member__email">{member.email}</span></button>)}</div>}</article>
      <article className="ui042-detail"><h2 className="ui042-section-title">구성원 상세</h2>{detailLoading ? <p className="ui042-state">loading · 상세 조회 중...</p> : detailError ? <div className="ui042-state is-error"><p>{detailError}</p><button type="button" onClick={() => selectedMemberId && void selectMember(selectedMemberId)}>다시 시도</button></div> : detail ? <div className="ui042-profile"><div aria-hidden="true">{detail.name.slice(0, 1)}</div><h3>{detail.name}</h3><dl><dt>이메일</dt><dd>{detail.email}</dd><dt>부서</dt><dd>{detail.departmentName || "미지정"}</dd><dt>역할</dt><dd>{detail.roleName}</dd></dl><button className="is-primary" type="button" onClick={() => onComposeMail(detail.email)}>메일 작성</button></div> : <p className="ui042-state">구성원을 선택하면 상세 정보가 표시됩니다.</p>}</article>
    </div>
    {popupOpen ? <div className="ui042-popup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePopup(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ui042-popup-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") closePopup(); }} className="ui042-popup"><header><h2 id="ui042-popup-title" className="ui042-section-title">구성원 선택</h2><button type="button" onClick={closePopup}>닫기</button></header><label>부서<select value={popupDepartmentId} onChange={(event) => setPopupDepartmentId(event.target.value)}><option value="">전체</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>검색<input value={popupQuery} maxLength={120} onChange={(event) => setPopupQuery(event.target.value)} /></label>{popupLoading ? <p className="ui042-state">loading · 구성원을 불러오는 중...</p> : popupError ? <div className="ui042-state is-error"><p>{popupError}</p><button type="button" onClick={() => setPopupReloadKey((current) => current + 1)}>다시 시도</button></div> : popupEmpty ? <p className="ui042-state">empty · 선택할 구성원이 없습니다.</p> : <fieldset><legend>구성원 한 명 선택</legend>{popupMembers.map((member) => <label key={member.id}><input type="radio" name="ui042-member" checked={popupSelectionId === member.id} onChange={() => setPopupSelectionId(member.id)} />{member.name} · {member.departmentName || "미지정"}</label>)}</fieldset>}<footer><button type="button" onClick={closePopup}>취소</button><button className="is-primary" type="button" disabled={!popupSelectionId} onClick={() => { void selectMember(popupSelectionId); closePopup(); }}>확인</button></footer></div></div> : null}
  </section>;
}
