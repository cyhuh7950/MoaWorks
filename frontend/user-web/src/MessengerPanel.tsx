import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiRequestError,
  createMessengerRoom,
  deleteMessengerRoom,
  downloadMessengerAttachment,
  favoriteMessengerRoom,
  fetchMe,
  fetchMessengerMessages,
  fetchMessengerRoom,
  fetchMessengerRooms,
  fetchTranslationStatus,
  fetchWorkspaceDirectory,
  readMessengerRoom,
  requestTranslation,
  leaveMessengerRoom,
  sendMessengerMessage,
  transferMessengerRoomOwner,
  updateMessengerRoomParticipants,
  updateMessengerRoomTranslation,
  uploadMessengerAttachment,
  type MessengerAttachment,
  type MessengerMessage,
  type MessengerRoomDetail,
  type MessengerRoomSummary,
  type WorkspaceDirectory,
} from "./api";
import { CommonPopup } from "./components/CommonPopup";


const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const ROOM_LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "zh-cn", label: "简体中文" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
] as const;
type RoomLanguage = (typeof ROOM_LANGUAGES)[number]["value"];

function languageLabel(locale: string) {
  return ROOM_LANGUAGES.find((item) => item.value === locale)?.label || locale;
}

function errorText(error: unknown) {
  return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
}

function formatTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

function formatSize(value: number) {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(value / 1024))} KB`;
}

export function MessengerPanel({ token }: { token: string }) {
  const [rooms, setRooms] = useState<MessengerRoomSummary[]>([]);
  const [room, setRoom] = useState<MessengerRoomDetail | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [directory, setDirectory] = useState<WorkspaceDirectory>({ departments: [], users: [] });
  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<MessengerAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [drawerTab, setDrawerTab] = useState<"participants" | "files">("participants");
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState<"direct" | "group">("group");
  const [newRoomLocale, setNewRoomLocale] = useState<RoomLanguage>("ko");
  const [translationLocaleDraft, setTranslationLocaleDraft] = useState<RoomLanguage>("ko");
  const [messageTranslations, setMessageTranslations] = useState<Record<string, string>>({});
  const [translationNotice, setTranslationNotice] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<"none" | "transfer" | "leave" | "delete">("none");
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const roomNameRef = useRef<HTMLInputElement>(null);
  const translationGenerationRef = useRef(0);
  const translationContextRef = useRef("");

  const loadMessageTranslations = useCallback(async (locale: RoomLanguage, items: MessengerMessage[], generation: number) => {
    const candidates = items.filter((item) => item.body.trim());
    if (!candidates.length) return;
    try {
      const status = await fetchTranslationStatus(token);
      if (!status.enabled || !status.available) {
        if (generation === translationGenerationRef.current) setTranslationNotice("LLM 번역이 비활성화되어 원문만 표시합니다.");
        return;
      }
      const translatedByMessage: Record<string, string> = {};
      for (let offset = 0; offset < candidates.length; offset += 64) {
        const batch = candidates.slice(offset, offset + 64);
        const response = await requestTranslation({
          texts: batch.map((item) => ({ text: item.body, sourceLocale: "auto", targetLocale: locale })),
          includeSource: true,
          useCache: true,
        }, token);
        response.items.forEach((translated, index) => {
          const message = batch[index];
          if (!message) return;
          const original = message.body;
          if (translated.translated && translated.translatedText.trim() && translated.translatedText.trim() !== original.trim()) {
            translatedByMessage[message.messageId] = translated.translatedText.trim();
          }
        });
      }
      if (generation !== translationGenerationRef.current) return;
      setMessageTranslations((current) => ({ ...current, ...translatedByMessage }));
      setTranslationNotice(`${languageLabel(locale)} 자동 번역`);
    } catch {
      if (generation === translationGenerationRef.current) setTranslationNotice("번역을 불러오지 못해 원문만 표시합니다.");
    }
  }, [token]);

  const loadRoom = useCallback(async (roomId: string) => {
    const generation = ++translationGenerationRef.current;
    setTimelineLoading(true);
    try {
      await readMessengerRoom(token, roomId);
      const [detail, response] = await Promise.all([fetchMessengerRoom(token, roomId), fetchMessengerMessages(token, roomId)]);
      const translationContext = `${roomId}:${detail.translationLocale}`;
      if (translationContextRef.current !== translationContext) {
        translationContextRef.current = translationContext;
        setMessageTranslations({});
        setTranslationNotice("");
      }
      setRoom(detail);
      setTranslationLocaleDraft(detail.translationLocale);
      setMessages(response.messages);
      setNextCursor(response.nextCursor);
      setRooms((current) => current.map((item) => item.roomId === roomId ? { ...item, unreadCount: 0, readState: "read", translationLocale: detail.translationLocale } : item));
      void loadMessageTranslations(detail.translationLocale, response.messages, generation);
    } finally {
      setTimelineLoading(false);
    }
  }, [loadMessageTranslations, token]);

  const refresh = useCallback(async (preferredRoomId?: string, resetSelection = false) => {
    try {
      setError("");
      const [response, members, me] = await Promise.all([fetchMessengerRooms(token), fetchWorkspaceDirectory(token), fetchMe(token)]);
      setRooms(response.rooms);
      setDirectory(members);
      setCurrentUserId(me.user.userId);
      const target = resetSelection ? response.rooms[0]?.roomId || "" : preferredRoomId || selectedId || response.rooms[0]?.roomId || "";
      if (target) {
        setSelectedId(target);
        await loadRoom(target);
      } else {
        translationContextRef.current = "";
        setRoom(null);
        setMessages([]);
        setMessageTranslations({});
        setTranslationNotice("");
        setNextCursor(null);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [loadRoom, selectedId, token]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(selectedId); }, 10_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(selectedId); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, selectedId]);

  const filteredRooms = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rooms.filter((item) => !normalized || `${item.roomName} ${item.lastMessage || ""}`.toLowerCase().includes(normalized));
  }, [query, rooms]);
  const favoriteRooms = filteredRooms.filter((item) => item.isFavorite);
  const recentRooms = filteredRooms.filter((item) => !item.isFavorite);
  const sharedFiles = useMemo(() => messages.flatMap((message) => message.attachments.map((attachment) => ({ message, attachment }))).reverse(), [messages]);

  async function selectRoom(roomId: string) {
    setSelectedId(roomId);
    setError("");
    try { await loadRoom(roomId); } catch (cause) { setError(errorText(cause)); }
  }

  async function toggleFavorite(item: MessengerRoomSummary) {
    try {
      await favoriteMessengerRoom(token, item.roomId, !item.isFavorite);
      await refresh(item.roomId);
    } catch (cause) { setError(errorText(cause)); }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || sending || (!draft.trim() && staged.length === 0)) return;
    setSending(true);
    setError("");
    try {
      await sendMessengerMessage(token, selectedId, { body: draft.trim(), messageType: staged.length ? "file" : "text", attachments: staged });
      setDraft("");
      setStaged([]);
      await refresh(selectedId);
    } catch (cause) { setError(errorText(cause)); }
    finally { setSending(false); }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (staged.length + selected.length > MAX_FILES) { setError("첨부는 최대 10개까지 가능합니다."); return; }
    if (selected.some((file) => file.size === 0 || file.size > MAX_FILE_BYTES)) { setError("빈 파일은 제외하고 파일당 10MB 이하만 첨부할 수 있습니다."); return; }
    if ([...staged.map((item) => item.sizeBytes), ...selected.map((file) => file.size)].reduce((sum, size) => sum + size, 0) > MAX_TOTAL_BYTES) { setError("첨부 전체 용량은 25MB 이하여야 합니다."); return; }
    setUploading(true);
    setError("");
    try {
      const uploaded = [] as MessengerAttachment[];
      for (const file of selected) uploaded.push(await uploadMessengerAttachment(token, file));
      setStaged((current) => [...current, ...uploaded]);
    } catch (cause) { setError(errorText(cause)); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  async function loadOlder() {
    if (!selectedId || !nextCursor || timelineLoading) return;
    setTimelineLoading(true);
    try {
      const response = await fetchMessengerMessages(token, selectedId, nextCursor);
      setMessages((current) => [...response.messages, ...current]);
      setNextCursor(response.nextCursor);
      if (room) void loadMessageTranslations(room.translationLocale, response.messages, translationGenerationRef.current);
    } catch (cause) { setError(errorText(cause)); }
    finally { setTimelineLoading(false); }
  }

  async function submitRoom(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await createMessengerRoom(token, { roomName, roomType, participantUserIds: participantIds, translationLocale: newRoomLocale });
      setCreateOpen(false); setRoomName(""); setParticipantIds([]); setNewRoomLocale("ko");
      await refresh(created.roomId);
    } catch (cause) { setError(errorText(cause)); }
  }

  async function saveRoomTranslationLocale() {
    if (!room || !room.canManageParticipants || translationLocaleDraft === room.translationLocale || lifecycleSaving) return;
    setLifecycleSaving(true);
    setError("");
    try {
      const updated = await updateMessengerRoomTranslation(token, room.roomId, translationLocaleDraft, room.updatedAt);
      await refresh(updated.roomId);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLifecycleSaving(false); }
  }
  function openParticipantEditor() {
    if (!room?.canManageParticipants) return;
    setParticipantIds(room.participantIds);
    setParticipantsOpen(true);
  }

  async function saveParticipants(event: FormEvent) {
    event.preventDefault();
    if (!room) return;
    try {
      const updated = await updateMessengerRoomParticipants(token, room.roomId, participantIds, room.updatedAt);
      setParticipantsOpen(false);
      await refresh(updated.roomId);
    } catch (cause) { setError(errorText(cause)); }
  }

  function openLifecycleAction(action: "transfer" | "leave" | "delete") {
    if (!room) return;
    setError("");
    setNewOwnerUserId(action === "transfer" ? room.participants.find((item) => item.userId !== room.createdByUserId)?.userId || "" : "");
    setLifecycleAction(action);
  }

  function closeLifecycleAction() {
    if (lifecycleSaving) return;
    setLifecycleAction("none");
    setNewOwnerUserId("");
  }

  async function transferRoomOwner(event: FormEvent) {
    event.preventDefault();
    if (!room || !newOwnerUserId || lifecycleSaving) return;
    setLifecycleSaving(true);
    setError("");
    try {
      const updated = await transferMessengerRoomOwner(token, room.roomId, newOwnerUserId, room.updatedAt);
      setLifecycleAction("none");
      setNewOwnerUserId("");
      await refresh(updated.roomId);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLifecycleSaving(false); }
  }

  async function leaveRoom() {
    if (!room || lifecycleSaving) return;
    setLifecycleSaving(true);
    setError("");
    try {
      await leaveMessengerRoom(token, room.roomId);
      setLifecycleAction("none");
      setSelectedId("");
      await refresh(undefined, true);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLifecycleSaving(false); }
  }

  async function deleteRoom() {
    if (!room || lifecycleSaving) return;
    setLifecycleSaving(true);
    setError("");
    try {
      await deleteMessengerRoom(token, room.roomId);
      setLifecycleAction("none");
      setSelectedId("");
      await refresh(undefined, true);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLifecycleSaving(false); }
  }

  function roomGroup(title: string, items: MessengerRoomSummary[]) {
    return <section className="ui040-room-group"><h3>{title}</h3>{items.map((item) => <article className={selectedId === item.roomId ? "is-selected" : ""} key={item.roomId}>
      <button className="ui040-room-select" type="button" onClick={() => void selectRoom(item.roomId)}>
        <strong className="ui040-room-name">{item.roomName}</strong>
        <small className="ui040-room-preview">{item.lastMessage || "메시지 없음"}</small>
        <span className="ui040-room-meta">{formatTime(item.lastMessageAt)} · {item.participantCount}명</span>
        {item.unreadCount ? <b>{item.unreadCount}</b> : null}
      </button>
      <button className="ui040-favorite" type="button" aria-label={`${item.roomName} ${item.isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}`} aria-pressed={item.isFavorite} onClick={() => void toggleFavorite(item)}>{item.isFavorite ? "★" : "☆"}</button>
      <button className="ui040-room-more" type="button" aria-label={`${item.roomName} 대화방 정보 열기`} onClick={() => { setDrawerTab("participants"); void selectRoom(item.roomId); }}>⋮</button>
    </article>)}</section>;
  }

  let previousDay = "";
  return <section className="ui040-messenger">
    <aside className="ui040-room-list"><header><h2>메신저</h2><button className="is-primary" type="button" onClick={() => setCreateOpen(true)}>새 대화</button></header>
      <label className="ui040-search"><span>대화방 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="방 이름 또는 최근 메시지" /></label>
      <div className="ui040-room-scroll">{loading ? <p className="ui040-state">대화방을 불러오는 중입니다.</p> : filteredRooms.length === 0 ? <p className="ui040-state">검색 결과가 없습니다.</p> : <>{roomGroup("즐겨찾기", favoriteRooms)}{roomGroup("최근 대화", recentRooms)}</>}</div>
    </aside>
    <main className="ui040-timeline"><header><div><h2>{room?.roomName || "대화방 선택"}</h2><small>{room ? `${room.participantCount}명 참여 · ${languageLabel(room.translationLocale)}` : "대화방을 선택하세요."}</small></div><div><button type="button" title="메시지는 2주 보관 후 만료됩니다." aria-label="보관 정책 안내">i</button><button type="button" onClick={() => void refresh(selectedId)} disabled={loading}>새로고침</button></div></header>
      <div className="ui040-message-scroll">{nextCursor ? <button type="button" onClick={() => void loadOlder()} disabled={timelineLoading}>과거 메시지 더 보기</button> : null}{timelineLoading && messages.length === 0 ? <p className="ui040-state">메시지를 불러오는 중입니다.</p> : messages.length === 0 ? <p className="ui040-state">첫 메시지를 보내보세요.</p> : messages.map((item) => {
        const day = formatDay(item.createdAt); const showDay = day !== previousDay; previousDay = day;
        const mine = item.senderUserId === currentUserId;
        return <div className="ui040-message-block" key={item.messageId}>{showDay ? <div className="ui040-day">{day}</div> : null}<article className={mine ? "is-mine" : "is-other"}><header><strong>{item.senderUserName}</strong><time>{formatTime(item.createdAt)}</time></header>{item.body ? messageTranslations[item.messageId] ? <><p className="ui040-message-original"><small>원문</small>{item.body}</p><p className="ui040-message-translation"><small>{languageLabel(room?.translationLocale || "ko")} 번역</small>{messageTranslations[item.messageId]}</p></> : <p>{item.body}</p> : null}{item.attachments.map((attachment) => <button className="ui040-file" type="button" key={attachment.attachmentId} onClick={() => void downloadMessengerAttachment(token, item.roomId, item.messageId, attachment)}>{attachment.fileName}<small>{formatSize(attachment.sizeBytes)}</small></button>)}{mine ? <small className="ui040-read-state">{item.unreadCount === 0 ? "모두 읽음" : `미읽음 ${item.unreadCount}명`}</small> : null}</article></div>;
      })}</div>
      <form className="ui040-composer" onSubmit={submitMessage}><div>{staged.map((item) => <span key={item.uploadId}>{item.fileName}<button type="button" aria-label={`${item.fileName} 첨부 제거`} onClick={() => setStaged((current) => current.filter((file) => file.uploadId !== item.uploadId))}>×</button></span>)}</div><textarea aria-label="메시지 입력" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} disabled={!selectedId || sending} placeholder="메시지를 입력하세요. Ctrl+Enter로 전송" /><input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} /><button type="button" onClick={() => fileInputRef.current?.click()} disabled={!selectedId || uploading || staged.length >= MAX_FILES}>첨부</button><button className="is-primary" type="submit" disabled={sending || !selectedId || (!draft.trim() && staged.length === 0)}>{sending ? "전송 중" : "전송"}</button></form>
      {translationNotice ? <p className="ui040-translation-notice" aria-live="polite">{translationNotice}</p> : null}
      {error ? <p className="ui040-error" role="alert">{error}</p> : null}
    </main>
    <aside className="ui040-drawer"><nav aria-label="대화방 정보"><button type="button" aria-pressed={drawerTab === "participants"} onClick={() => setDrawerTab("participants")}>참여자</button><button type="button" aria-pressed={drawerTab === "files"} onClick={() => setDrawerTab("files")}>공유 파일</button></nav>{drawerTab === "participants" ? <section><header><h2>참여자</h2>{room?.canManageParticipants ? <button type="button" onClick={openParticipantEditor}>참여자 변경</button> : null}</header>{room?.participants.map((item) => <article key={item.userId}><strong>{item.userName}</strong><span>{item.departmentName || "부서 미지정"}</span><small>{item.userEmail}</small><time>{item.lastReadAt ? `최근 읽음 ${formatTime(item.lastReadAt)}` : "읽음 기록 없음"}</time></article>)}</section> : <section><h2>공유 파일</h2>{sharedFiles.length ? sharedFiles.map(({ message, attachment }) => <button className="ui040-shared-file" type="button" key={attachment.attachmentId} onClick={() => void downloadMessengerAttachment(token, message.roomId, message.messageId, attachment)}><strong>{attachment.fileName}</strong><small>{formatSize(attachment.sizeBytes)} · {formatTime(message.createdAt)}</small></button>) : <p className="ui040-state">공유된 파일이 없습니다.</p>}</section>}{room ? <section className="ui040-room-management"><header><h2>대화방 관리</h2></header><label>대화방 언어<select value={translationLocaleDraft} disabled={!room.canManageParticipants || lifecycleSaving} onChange={(event) => setTranslationLocaleDraft(event.target.value as RoomLanguage)}>{ROOM_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{room.canManageParticipants ? <button type="button" onClick={() => void saveRoomTranslationLocale()} disabled={lifecycleSaving || translationLocaleDraft === room.translationLocale}>언어 저장</button> : null}<p>원문은 보존하며 LLM이 활성화된 경우 선택 언어 번역을 함께 표시합니다.</p><p>나가면 참여가 종료됩니다. 삭제된 대화와 첨부는 14일 후 자동 정리됩니다.</p>{room.canDelete ? <button type="button" onClick={() => openLifecycleAction("transfer")} disabled={lifecycleSaving || room.participants.length < 2}>방장 이전</button> : null}{room.canLeave ? <button type="button" onClick={() => openLifecycleAction("leave")} disabled={lifecycleSaving}>대화방 나가기</button> : null}{room.canDelete ? <button type="button" onClick={() => openLifecycleAction("delete")} disabled={lifecycleSaving}>대화방 삭제</button> : null}</section> : null}</aside>
    <CommonPopup title="새 대화" open={createOpen} onClose={() => setCreateOpen(false)} dirty={Boolean(roomName || participantIds.length)} error={error} initialFocusRef={roomNameRef} className="ui040-popup"><form onSubmit={submitRoom}><label>대화방 이름<input ref={roomNameRef} required maxLength={80} value={roomName} onChange={(event) => setRoomName(event.target.value)} /></label><label>대화 유형<select value={roomType} onChange={(event) => setRoomType(event.target.value as "direct" | "group")}><option value="direct">1:1 대화</option><option value="group">그룹 대화</option></select></label><label>대화방 언어<select value={newRoomLocale} onChange={(event) => setNewRoomLocale(event.target.value as RoomLanguage)}>{ROOM_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><fieldset><legend>참여자 선택</legend>{directory.users.filter((user) => user.id !== currentUserId).map((user) => <label key={user.id}><input type="checkbox" checked={participantIds.includes(user.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} />{user.name} · {user.department_name || "미지정"}</label>)}</fieldset><footer><button type="button" onClick={() => setCreateOpen(false)}>취소</button><button className="is-primary" type="submit">생성</button></footer></form></CommonPopup>
    <CommonPopup title="참여자 변경" open={participantsOpen} onClose={() => setParticipantsOpen(false)} dirty={Boolean(room && participantIds.join() !== room.participantIds.join())} error={error} className="ui040-popup"><form onSubmit={saveParticipants}><fieldset><legend>같은 회사의 활성 사용자</legend>{directory.users.map((user) => <label key={user.id}><input type="checkbox" checked={participantIds.includes(user.id)} disabled={user.id === room?.createdByUserId} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} />{user.name} · {user.department_name || "미지정"}</label>)}</fieldset><footer><button type="button" onClick={() => setParticipantsOpen(false)}>취소</button><button className="is-primary" type="submit">저장</button></footer></form></CommonPopup>
    <CommonPopup title={lifecycleAction === "transfer" ? "방장 이전" : lifecycleAction === "leave" ? "대화방 나가기" : "대화방 삭제"} open={lifecycleAction !== "none"} onClose={closeLifecycleAction} saving={lifecycleSaving} error={error} className="ui040-popup" kind="alertdialog">{lifecycleAction === "transfer" ? <form onSubmit={transferRoomOwner}><p>새 방장을 선택하면 현재 방장은 일반 참여자로 유지됩니다.</p><label>새 방장<select required value={newOwnerUserId} onChange={(event) => setNewOwnerUserId(event.target.value)}><option value="">선택</option>{room?.participants.filter((item) => item.userId !== room.createdByUserId).map((item) => <option key={item.userId} value={item.userId}>{item.userName}</option>)}</select></label><footer><button type="button" onClick={closeLifecycleAction} disabled={lifecycleSaving}>취소</button><button className="is-primary" type="submit" disabled={!newOwnerUserId || lifecycleSaving}>이전</button></footer></form> : <div><p>{lifecycleAction === "leave" ? "이 대화방에서 나가면 다시 초대되기 전까지 대화를 볼 수 없습니다." : "대화방을 삭제하면 즉시 목록에서 숨겨지고 대화와 첨부는 14일 후 자동 정리됩니다."}</p><footer><button type="button" onClick={closeLifecycleAction} disabled={lifecycleSaving}>취소</button><button className="is-primary" type="button" onClick={() => void (lifecycleAction === "leave" ? leaveRoom() : deleteRoom())} disabled={lifecycleSaving}>{lifecycleAction === "leave" ? "나가기" : "삭제"}</button></footer></div>}</CommonPopup>
  </section>;
}
