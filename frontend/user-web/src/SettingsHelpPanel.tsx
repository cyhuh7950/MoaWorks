import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiRequestError,
  changePassword,
  deleteWorkspaceProfilePhoto,
  fetchNotificationPreferences,
  fetchWorkspaceHelpPolicies,
  fetchWorkspacePreferences,
  fetchWorkspaceProfile,
  fetchWorkspaceProfilePhoto,
  saveNotificationPreferences,
  saveWorkspacePreferences,
  saveWorkspaceProfile,
  saveWorkspaceProfilePhoto,
  type NotificationPreferences,
  type WorkspaceHelpPolicy,
  type WorkspacePreferences,
  type WorkspaceProfile,
} from "./api";
import { CommonPopup } from "./components/CommonPopup";
import { supportedLocales, supportedTimezones } from "./i18n";

type Section = "profile" | "general" | "notifications" | "security" | "modules";
type Popup = "none" | "general" | "notifications" | "password";
type Props = {
  mode: "settings" | "help";
  token: string;
  onPreferencesSaved: (locale: string, timezone: string) => void;
  onProfileSaved: () => void;
  onOpenWorkspaceSettings: (target: "mail" | "approval" | "calendar") => void;
  translationTool?: React.ReactNode;
};

const settingsSections: Array<{ key: Section; label: string }> = [
  { key: "profile", label: "프로필" }, { key: "general", label: "일반 설정" }, { key: "notifications", label: "알림 설정" },
  { key: "security", label: "보안" }, { key: "modules", label: "업무별 설정" },
];
const helpCategories = [{ key: "all", label: "전체" }, { key: "guide", label: "사용자 가이드" }, { key: "policy", label: "정책" }, { key: "error", label: "오류 안내" }];
const startPages = [{ key: "home", label: "홈" }, { key: "mail", label: "메일" }, { key: "approval", label: "결재" }, { key: "messenger", label: "메신저" }, { key: "schedule", label: "일정" }, { key: "contacts", label: "주소록" }, { key: "org", label: "조직도" }, { key: "files", label: "파일" }] as const;
const categoryLabels: Record<string, string> = { mail: "메일", approval: "전자결재", messenger: "메신저", schedule: "일정", file: "파일", notice: "공지", system: "시스템 공지" };
const defaultNotifications: NotificationPreferences = { enabled: true, quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", categories: {}, updatedAt: null };
const defaultPreferences: WorkspacePreferences = { locale: "ko-KR", timezone: "Asia/Seoul", startPage: "home", version: 0 };

function message(error: unknown, fallback: string) {
  return error instanceof ApiRequestError || error instanceof Error ? error.message : fallback;
}

function Info({ label, title }: { label: string; title: string }) {
  return <button type="button" className="ui044-settings-help__info" aria-label={label} title={title}>i</button>;
}

const emptyProfileDraft = { externalEmail: "", mobilePhone: "", officePhone: "", introduction: "", postalCode: "", addressLine1: "", addressLine2: "", memo: "", anniversary: "", expectedVersion: 0 };

export function SettingsHelpPanel({ mode, token, onPreferencesSaved, onProfileSaved, onOpenWorkspaceSettings, translationTool }: Props) {
  const [section, setSection] = useState<Section>("profile");
  const [profile, setProfile] = useState<WorkspaceProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState(emptyProfileDraft);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [removeProfilePhoto, setRemoveProfilePhoto] = useState(false);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(defaultPreferences);
  const [preferenceDraft, setPreferenceDraft] = useState<WorkspacePreferences>(defaultPreferences);
  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications);
  const [notificationDraft, setNotificationDraft] = useState<NotificationPreferences>(defaultNotifications);
  const [popup, setPopup] = useState<Popup>("none");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [notice, setNotice] = useState("");
  const [popupError, setPopupError] = useState("");
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [helpCategory, setHelpCategory] = useState("all");
  const [helpItems, setHelpItems] = useState<WorkspaceHelpPolicy[]>([]);
  const [selectedHelpId, setSelectedHelpId] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  const profilePhotoUrlRef = useRef("");

  const replaceProfilePhotoUrl = (nextUrl: string) => {
    if (profilePhotoUrlRef.current) URL.revokeObjectURL(profilePhotoUrlRef.current);
    profilePhotoUrlRef.current = nextUrl;
    setProfilePhotoUrl(nextUrl);
  };

  const loadProfilePhoto = async (nextProfile: WorkspaceProfile) => {
    if (!nextProfile.photoAvailable) { replaceProfilePhotoUrl(""); return; }
    const blob = await fetchWorkspaceProfilePhoto(token);
    replaceProfilePhotoUrl(blob ? URL.createObjectURL(blob) : "");
  };

  const loadSettings = async () => {
    setLoading(true); setError(""); setProfileError("");
    try {
      const [nextProfile, nextPreferences, nextNotifications] = await Promise.all([
        fetchWorkspaceProfile(token), fetchWorkspacePreferences(token), fetchNotificationPreferences(token),
      ]);
      setProfile(nextProfile); setProfileDraft({ externalEmail: nextProfile.externalEmail, mobilePhone: nextProfile.mobilePhone, officePhone: nextProfile.officePhone, introduction: nextProfile.introduction, postalCode: nextProfile.postalCode, addressLine1: nextProfile.addressLine1, addressLine2: nextProfile.addressLine2, memo: nextProfile.memo, anniversary: nextProfile.anniversary ?? "", expectedVersion: nextProfile.version });
      setProfilePhotoFile(null); setRemoveProfilePhoto(false);
      try { await loadProfilePhoto(nextProfile); }
      catch { replaceProfilePhotoUrl(""); setProfileError("프로필 사진을 불러오지 못했습니다. 다른 설정은 계속 사용할 수 있습니다."); }
      setPreferences(nextPreferences); setPreferenceDraft(nextPreferences);
      setNotifications(nextNotifications); setNotificationDraft(nextNotifications);
    } catch (cause) { setError(message(cause, "개인 설정을 불러오지 못했습니다.")); }
    finally { setLoading(false); }
  };

  const loadHelp = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetchWorkspaceHelpPolicies(token, { query: debouncedQuery, category: helpCategory === "all" ? undefined : helpCategory });
      setHelpItems(response.items);
      setSelectedHelpId(current => response.items.some(item => item.id === current) ? current : response.items[0]?.id ?? "");
    } catch (cause) { setError(message(cause, "Help 문서를 불러오지 못했습니다.")); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (mode === "settings") void loadSettings(); }, [mode, token]);
  useEffect(() => () => { if (profilePhotoUrlRef.current) URL.revokeObjectURL(profilePhotoUrlRef.current); }, []);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { if (mode === "help") void loadHelp(); }, [mode, token, debouncedQuery, helpCategory]);

  const selectedHelp = helpItems.find(item => item.id === selectedHelpId) ?? null;
  const preferenceDirty = JSON.stringify(preferenceDraft) !== JSON.stringify(preferences);
  const notificationDirty = JSON.stringify(notificationDraft) !== JSON.stringify(notifications);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setProfileError(""); setNotice("");
    try {
      let saved = await saveWorkspaceProfile(token, { ...profileDraft, anniversary: profileDraft.anniversary || null });
      if (profilePhotoFile) saved = await saveWorkspaceProfilePhoto(token, profilePhotoFile, saved.version);
      else if (removeProfilePhoto && saved.photoAvailable) saved = await deleteWorkspaceProfilePhoto(token, saved.version);
      const confirmed = await fetchWorkspaceProfile(token);
      setProfile(confirmed); setProfileDraft({ externalEmail: confirmed.externalEmail, mobilePhone: confirmed.mobilePhone, officePhone: confirmed.officePhone, introduction: confirmed.introduction, postalCode: confirmed.postalCode, addressLine1: confirmed.addressLine1, addressLine2: confirmed.addressLine2, memo: confirmed.memo, anniversary: confirmed.anniversary ?? "", expectedVersion: confirmed.version });
      setProfilePhotoFile(null); setRemoveProfilePhoto(false); await loadProfilePhoto(confirmed); onProfileSaved();
      setNotice("프로필을 저장했습니다.");
    } catch (cause) { setProfileError(message(cause, "프로필을 저장하지 못했습니다.")); }
    finally { setSaving(false); }
  };

  const chooseProfilePhoto = (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setProfileError("프로필 사진은 2MB 이하만 등록할 수 있습니다."); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setProfileError("프로필 사진은 JPEG, PNG, WebP 형식만 등록할 수 있습니다."); return; }
    setProfileError("");
    setProfilePhotoFile(file); setRemoveProfilePhoto(false); replaceProfilePhotoUrl(URL.createObjectURL(file));
  };

  const saveGeneral = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setPopupError("");
    try {
      const saved = await saveWorkspacePreferences(token, preferenceDraft);
      const confirmed = await fetchWorkspacePreferences(token);
      setPreferences(confirmed); setPreferenceDraft(confirmed); onPreferencesSaved(saved.locale, saved.timezone);
      setPopup("none"); setNotice("일반 설정을 저장했습니다.");
    } catch (cause) {
      setPopupError(cause instanceof ApiRequestError && cause.status === 409 ? "다른 화면에서 설정이 변경되었습니다. 닫고 최신 설정을 다시 불러오세요." : message(cause, "설정을 저장하지 못했습니다."));
    } finally { setSaving(false); }
  };

  const saveNotifications = async () => {
    setSaving(true); setPopupError("");
    try {
      const saved = await saveNotificationPreferences(token, notificationDraft);
      const confirmed = await fetchNotificationPreferences(token);
      setNotifications(confirmed); setNotificationDraft(confirmed); setPopup("none"); setNotice("알림 설정을 저장했습니다.");
      if (JSON.stringify(saved) !== JSON.stringify(confirmed)) setNotice("알림 설정을 서버 최신값으로 확인했습니다.");
    } catch (cause) { setPopupError(message(cause, "알림 설정을 저장하지 못했습니다.")); }
    finally { setSaving(false); }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault(); setPopupError("");
    if (password.newPassword !== password.confirmPassword) { setPopupError("새 비밀번호 확인이 일치하지 않습니다."); return; }
    if (password.newPassword.length < 8 || password.newPassword.length > 128) { setPopupError("새 비밀번호는 8~128자로 입력하세요."); return; }
    setSaving(true);
    try {
      await changePassword(token, { currentPassword: password.currentPassword, newPassword: password.newPassword });
      setPassword({ currentPassword: "", newPassword: "", confirmPassword: "" }); setPopup("none"); setNotice("비밀번호를 변경했습니다.");
    } catch (cause) { setPopupError(message(cause, "비밀번호를 변경하지 못했습니다.")); }
    finally { setSaving(false); }
  };

  const openPopup = (next: Popup) => {
    setPopupError("");
    if (next === "general") setPreferenceDraft(preferences);
    if (next === "notifications") setNotificationDraft(notifications);
    if (next === "password") setPassword({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPopup(next);
  };
  const closePopup = () => { setPopup("none"); setPopupError(""); if (popup === "password") setPassword({ currentPassword: "", newPassword: "", confirmPassword: "" }); };
  const updateCategory = (key: string, field: "enabled" | "importantOnly", value: boolean) => setNotificationDraft(current => ({ ...current, categories: { ...current.categories, [key]: { ...(current.categories[key] ?? { enabled: true, importantOnly: false }), [field]: value } } }));

  if (mode === "help") return <section className="ui044-settings-help" aria-busy={loading}>
    <aside className="ui044-settings-help__nav"><h1 className="ui044-settings-help__title">Help / 정책</h1><label className="ui044-settings-help__search"><span>Help 검색</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="제목, 코드, 본문 검색" /></label><nav aria-label="Help 분류">{helpCategories.map(item => <button key={item.key} type="button" aria-current={helpCategory === item.key ? "page" : undefined} onClick={() => setHelpCategory(item.key)}>{item.label}</button>)}</nav><div className="ui044-settings-help__list">{helpItems.map(item => <button key={item.id} type="button" className={selectedHelpId === item.id ? "is-selected" : ""} onClick={() => setSelectedHelpId(item.id)}><strong>{item.title}</strong><span>{helpCategories.find(category => category.key === item.category)?.label ?? item.category} · {item.code}</span></button>)}</div>{!loading && !error && !helpItems.length ? <div className="ui044-settings-help__state">검색 결과가 없습니다.</div> : null}</aside>
    <main className="ui044-settings-help__detail">{error ? <div role="alert" className="ui044-settings-help__state is-error">{error}<button type="button" onClick={() => void loadHelp()}>다시 시도</button></div> : loading ? <div className="ui044-settings-help__state">Help 문서를 불러오는 중입니다.</div> : selectedHelp ? <article><header><span>{helpCategories.find(item => item.key === selectedHelp.category)?.label ?? selectedHelp.category}</span><h2 className="ui044-settings-help__section-title">{selectedHelp.title}</h2><time>{new Date(selectedHelp.updated_at).toLocaleDateString("ko-KR")}</time></header><p>{selectedHelp.content}</p></article> : <div className="ui044-settings-help__state">문서를 선택하세요.</div>}</main>
  </section>;

  const settingsDetail = (() => {
    if (loading) return <div className="ui044-settings-help__state">개인 설정을 불러오는 중입니다.</div>;
    if (error) return <div role="alert" className="ui044-settings-help__state is-error">{error}<button type="button" onClick={() => void loadSettings()}>다시 시도</button></div>;
    if (section === "profile") return <article className="ui044-profile"><header><h2 className="ui044-settings-help__section-title">프로필</h2><Info label="개인 설정 설명" title="이름·회사·부서·역할·계정 이메일은 조직 관리 정보이며, 개인 연락처와 사진은 본인이 관리합니다." /></header><div className="ui044-profile__summary"><div className="ui044-profile__avatar">{profilePhotoUrl ? <img src={profilePhotoUrl} alt={`${profile?.name ?? "사용자"} 프로필 사진`} /> : <span aria-hidden="true">{profile?.name?.trim().slice(0, 1) || "사용"}</span>}</div><dl><dt>이름</dt><dd>{profile?.name ?? "-"}</dd><dt>계정 이메일</dt><dd>{profile?.email ?? "-"}</dd><dt>회사</dt><dd>{profile?.companyName ?? "-"}</dd><dt>부서</dt><dd>{profile?.departmentName || "-"}</dd><dt>역할</dt><dd>{profile?.roleName ?? "-"}</dd></dl></div><form className="ui044-profile__form" onSubmit={saveProfile}><fieldset><legend>프로필 사진</legend><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => chooseProfilePhoto(event.target.files?.[0] ?? null)} /><span>JPEG, PNG, WebP · 최대 2MB</span>{profilePhotoUrl ? <button type="button" onClick={() => { setProfilePhotoFile(null); setRemoveProfilePhoto(true); replaceProfilePhotoUrl(""); }}>사진 삭제</button> : null}</fieldset><div className="ui044-profile__grid"><label><span>외부 이메일</span><input type="email" value={profileDraft.externalEmail} onChange={event => setProfileDraft(current => ({ ...current, externalEmail: event.target.value }))} /></label><label><span>휴대전화</span><input value={profileDraft.mobilePhone} onChange={event => setProfileDraft(current => ({ ...current, mobilePhone: event.target.value }))} /></label><label><span>직통전화</span><input value={profileDraft.officePhone} onChange={event => setProfileDraft(current => ({ ...current, officePhone: event.target.value }))} /></label><label><span>기념일</span><input type="date" value={profileDraft.anniversary} onChange={event => setProfileDraft(current => ({ ...current, anniversary: event.target.value }))} /></label><label><span>우편번호</span><input value={profileDraft.postalCode} onChange={event => setProfileDraft(current => ({ ...current, postalCode: event.target.value }))} /></label><label className="is-wide"><span>주소</span><input value={profileDraft.addressLine1} onChange={event => setProfileDraft(current => ({ ...current, addressLine1: event.target.value }))} /></label><label className="is-wide"><span>상세주소</span><input value={profileDraft.addressLine2} onChange={event => setProfileDraft(current => ({ ...current, addressLine2: event.target.value }))} /></label><label className="is-wide"><span>자기소개</span><textarea maxLength={2000} value={profileDraft.introduction} onChange={event => setProfileDraft(current => ({ ...current, introduction: event.target.value }))} /></label><label className="is-wide"><span>메모</span><textarea maxLength={2000} value={profileDraft.memo} onChange={event => setProfileDraft(current => ({ ...current, memo: event.target.value }))} /></label></div><footer><button className="is-primary" disabled={saving}>{saving ? "저장 중" : "프로필 저장"}</button></footer></form></article>;
    if (section === "general") return <article><header><h2 className="ui044-settings-help__section-title">일반 설정</h2><Info label="개인 설정 설명" title="언어와 시간대는 즉시 적용되고 시작 화면은 다음 로그인부터 적용됩니다." /></header><dl><dt>언어</dt><dd>{preferences.locale}</dd><dt>시간대</dt><dd>{preferences.timezone}</dd><dt>시작 화면</dt><dd>{startPages.find(item => item.key === preferences.startPage)?.label}</dd></dl><button type="button" className="is-primary" onClick={() => openPopup("general")}>설정 변경</button></article>;
    if (section === "notifications") return <article><header><h2 className="ui044-settings-help__section-title">알림 설정</h2><Info label="개인 설정 설명" title="전체 알림의 설정과 같은 원본을 사용합니다." /></header><dl><dt>앱 내 알림</dt><dd>{notifications.enabled ? "사용" : "사용 안 함"}</dd><dt>방해 금지</dt><dd>{notifications.quietHoursEnabled ? `${notifications.quietHoursStart}~${notifications.quietHoursEnd}` : "사용 안 함"}</dd><dt>업무 분류</dt><dd>{Object.keys(notifications.categories).length}개</dd></dl><button type="button" className="is-primary" onClick={() => openPopup("notifications")}>알림 설정 변경</button></article>;
    if (section === "security") return <article><header><h2 className="ui044-settings-help__section-title">보안</h2><Info label="개인 설정 설명" title="현재 비밀번호 확인 후 새 비밀번호를 저장합니다." /></header><p className="ui044-settings-help__helper">비밀번호 상태나 저장값은 화면에 표시하지 않습니다.</p><button type="button" className="is-primary" onClick={() => openPopup("password")}>비밀번호 변경</button></article>;
    return <article><header><h2 className="ui044-settings-help__section-title">업무별 설정</h2><Info label="개인 설정 설명" title="각 업무가 보유한 설정 화면으로 이동합니다." /></header><div className="ui044-settings-help__module-links"><button type="button" onClick={() => onOpenWorkspaceSettings("mail")}>메일 환경설정</button><button type="button" onClick={() => onOpenWorkspaceSettings("approval")}>결재 환경설정</button><button type="button" onClick={() => onOpenWorkspaceSettings("calendar")}>캘린더 환경설정</button></div></article>;
  })();

  return <section className="ui044-settings-help" aria-busy={loading}>
    <aside className="ui044-settings-help__nav"><header><h1 className="ui044-settings-help__title">개인 설정</h1><Info label="개인 설정 설명" title="프로필과 공통 업무 환경을 확인하고 변경합니다." /></header><nav aria-label="개인 설정 분류">{settingsSections.map(item => <button key={item.key} type="button" aria-current={section === item.key ? "page" : undefined} onClick={() => setSection(item.key)}>{item.label}</button>)}</nav></aside>
    <main className="ui044-settings-help__detail">{notice ? <div role="status" className="ui044-settings-help__notice">{notice}</div> : null}{section === "profile" && profileError ? <div role="alert" className="ui044-settings-help__state is-error">{profileError}</div> : null}{settingsDetail}{translationTool}</main>
    <CommonPopup title="일반 설정 변경" open={popup === "general"} onClose={closePopup} dirty={preferenceDirty} error={popupError} saving={saving}><form className="ui044-settings-help__form" onSubmit={saveGeneral}><label><span>언어</span><select value={preferenceDraft.locale} onChange={event => setPreferenceDraft(current => ({ ...current, locale: event.target.value }))}>{supportedLocales.map(item => <option key={item}>{item}</option>)}</select></label><label><span>시간대</span><select value={preferenceDraft.timezone} onChange={event => setPreferenceDraft(current => ({ ...current, timezone: event.target.value }))}>{supportedTimezones.map(item => <option key={item}>{item}</option>)}</select></label><label><span>시작 화면</span><select value={preferenceDraft.startPage} onChange={event => setPreferenceDraft(current => ({ ...current, startPage: event.target.value as WorkspacePreferences["startPage"] }))}>{startPages.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><footer><button type="button" onClick={closePopup}>취소</button><button className="is-primary" disabled={saving}>저장</button></footer></form></CommonPopup>
    <CommonPopup title="알림 설정 변경" open={popup === "notifications"} onClose={closePopup} dirty={notificationDirty} error={popupError} saving={saving}><div className="ui044-settings-help__form"><label><input type="checkbox" checked={notificationDraft.enabled} onChange={event => setNotificationDraft(current => ({ ...current, enabled: event.target.checked }))} /> 앱 내 알림 사용</label><div className="ui044-settings-help__notification-grid">{Object.entries(categoryLabels).map(([key, label]) => <fieldset key={key}><legend>{label}</legend><label><input type="checkbox" checked={notificationDraft.categories[key]?.enabled ?? true} onChange={event => updateCategory(key, "enabled", event.target.checked)} /> 알림 사용</label><label><input type="checkbox" checked={notificationDraft.categories[key]?.importantOnly ?? false} onChange={event => updateCategory(key, "importantOnly", event.target.checked)} /> 중요 알림만</label></fieldset>)}</div><label><input type="checkbox" checked={notificationDraft.quietHoursEnabled} onChange={event => setNotificationDraft(current => ({ ...current, quietHoursEnabled: event.target.checked }))} /> 방해 금지 시간 사용</label><div className="ui044-settings-help__times"><input type="time" value={notificationDraft.quietHoursStart} onChange={event => setNotificationDraft(current => ({ ...current, quietHoursStart: event.target.value }))} /><input type="time" value={notificationDraft.quietHoursEnd} onChange={event => setNotificationDraft(current => ({ ...current, quietHoursEnd: event.target.value }))} /></div><footer><button type="button" onClick={closePopup}>취소</button><button type="button" className="is-primary" disabled={saving} onClick={() => void saveNotifications()}>저장</button></footer></div></CommonPopup>
    <CommonPopup title="비밀번호 변경" open={popup === "password"} onClose={closePopup} dirty={Object.values(password).some(Boolean)} error={popupError} saving={saving} initialFocusRef={firstInput}><form className="ui044-settings-help__form" onSubmit={submitPassword}><label><span>현재 비밀번호</span><input ref={firstInput} type="password" autoComplete="current-password" value={password.currentPassword} onChange={event => setPassword(current => ({ ...current, currentPassword: event.target.value }))} required /></label><label><span>새 비밀번호</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password.newPassword} onChange={event => setPassword(current => ({ ...current, newPassword: event.target.value }))} required /></label><label><span>새 비밀번호 확인</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password.confirmPassword} onChange={event => setPassword(current => ({ ...current, confirmPassword: event.target.value }))} required /></label><footer><button type="button" onClick={closePopup}>취소</button><button className="is-primary" disabled={saving}>변경</button></footer></form></CommonPopup>
  </section>;
}
