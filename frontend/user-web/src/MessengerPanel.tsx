import { FormEvent, useEffect, useState } from "react";

import { ApiRequestError, createMessengerRoom, fetchMessengerMessages, fetchMessengerRoom, fetchMessengerRooms, fetchWorkspaceDirectory, readMessengerRoom, sendMessengerMessage, updateMessengerRoomParticipants, type MessengerMessage, type MessengerRoomDetail, type MessengerRoomSummary, type WorkspaceDirectory } from "./api";

const button = { height: 36, borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", padding: "0 12px", cursor: "pointer" } as const;
const primary = { ...button, border: 0, color: "#fff", background: "#0f766e", fontWeight: 700 } as const;

function errorText(error: unknown) { return error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "요청 처리에 실패했습니다."; }

export function MessengerPanel({ token }: { token: string }) {
  const [rooms, setRooms] = useState<MessengerRoomSummary[]>([]);
  const [room, setRoom] = useState<MessengerRoomDetail | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [directory, setDirectory] = useState<WorkspaceDirectory>({ departments: [], users: [] });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [participantsOpen, setParticipantsOpen] = useState(false);

  async function select(roomId: string) {
    try {
      setError("");
      await readMessengerRoom(token, roomId);
      const [detail, list] = await Promise.all([fetchMessengerRoom(token, roomId), fetchMessengerMessages(token, roomId)]);
      setSelectedId(roomId); setRoom(detail); setMessages(list.messages);
      setRooms((current) => current.map((item) => item.roomId === roomId ? { ...item, unreadCount: 0 } : item));
    } catch (cause) { setError(errorText(cause)); }
  }
  async function refresh(preferred?: string) {
    try {
      const [response, members] = await Promise.all([fetchMessengerRooms(token), fetchWorkspaceDirectory(token)]);
      setRooms(response.rooms); setDirectory(members);
      const target = preferred || selectedId || response.rooms[0]?.roomId;
      if (target) await select(target); else { setRoom(null); setMessages([]); }
    } catch (cause) { setError(errorText(cause)); }
  }
  useEffect(() => { void refresh(); }, [token]);
  async function submitMessage(event: FormEvent) { event.preventDefault(); if (!selectedId || !draft.trim()) return; try { await sendMessengerMessage(token, selectedId, { body: draft.trim() }); setDraft(""); await select(selectedId); } catch (cause) { setError(errorText(cause)); } }
  async function submitRoom(event: FormEvent) { event.preventDefault(); try { const created = await createMessengerRoom(token, { roomName, participantUserIds: participantIds }); setCreateOpen(false); setRoomName(""); setParticipantIds([]); await refresh(created.roomId); } catch (cause) { setError(errorText(cause)); } }
  function openParticipantEditor() { if (!room) return; setParticipantIds(room.participants.map((item) => item.userId)); setParticipantsOpen(true); }
  async function saveParticipants(event: FormEvent) { event.preventDefault(); if (!selectedId) return; try { const updated = await updateMessengerRoomParticipants(token, selectedId, participantIds); setRoom(updated); setParticipantsOpen(false); await refresh(updated.roomId); } catch (cause) { setError(errorText(cause)); } }
  return <section style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(420px,1fr) 240px", gap: 16 }}>
    <article style={{ minHeight: 0, overflow: "auto", border: "1px solid #dbe4ec", borderRadius: 18, padding: 16, background: "#fff" }}><header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><h2 style={{ margin: 0, fontSize: 22 }}>대화방</h2><button type="button" onClick={() => setCreateOpen(true)} style={primary}>새 대화</button></header><div style={{ marginTop: 12, display: "grid", gap: 6 }}>{rooms.map((item) => <button key={item.roomId} type="button" onClick={() => void select(item.roomId)} style={{ ...button, height: "auto", minHeight: 54, textAlign: "left", background: selectedId === item.roomId ? "#e6fffb" : "#fff" }}><strong>{item.roomName}</strong><div style={{ color: "#64748b", marginTop: 4 }}>{item.lastMessage || "메시지 없음"} · 미읽음 {item.unreadCount}</div></button>)}</div></article>
    <article style={{ minHeight: 0, overflow: "auto", border: "1px solid #dbe4ec", borderRadius: 18, padding: 16, background: "#fff", display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto" }}><header><h2 style={{ margin: 0, fontSize: 22 }}>{room?.roomName || "대화방 선택"}</h2><div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>읽음 상태는 대화방 선택 시 저장됩니다.</div></header><div style={{ overflow: "auto", marginTop: 14, display: "grid", alignContent: "start", gap: 8 }}>{messages.map((item) => <div key={item.messageId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}><strong>{item.senderUserName}</strong><div style={{ marginTop: 5, whiteSpace: "pre-wrap" }}>{item.body}</div></div>)}</div><form onSubmit={submitMessage} style={{ display: "flex", gap: 8, marginTop: 12 }}><input aria-label="메시지 입력" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!selectedId} placeholder="메시지를 입력하세요." style={{ flex: 1, height: 36, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 10px" }}/><button type="submit" disabled={!selectedId || !draft.trim()} style={primary}>전송</button></form></article>
    <article style={{ minHeight: 0, overflow: "auto", border: "1px solid #dbe4ec", borderRadius: 18, padding: 16, background: "#fff" }}><header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><h2 style={{ margin: 0, fontSize: 22 }}>참여자</h2><button type="button" onClick={openParticipantEditor} disabled={!room} style={button}>참여자 변경</button></header><div style={{ marginTop: 12, display: "grid", gap: 6 }}>{room?.participants.map((item) => <div key={item.userId} style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 8 }}>{item.userName}<div style={{ color: "#64748b", fontSize: 12 }}>{item.userEmail}</div></div>)}</div>{error ? <div style={{ color: "#b91c1c", marginTop: 12, fontSize: 12 }}>{error}</div> : null}</article>
    {participantsOpen ? <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 24, background: "rgba(15,23,42,.42)" }}><form onSubmit={saveParticipants} style={{ width: "min(520px,100%)", maxHeight: "80vh", overflow: "auto", borderRadius: 18, background: "#fff", padding: 20 }}><header style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 22 }}>참여자 변경</h2><button type="button" onClick={() => setParticipantsOpen(false)} style={button}>닫기</button></header><div style={{ marginTop: 12, display: "grid", gap: 6 }}>{directory.users.map((user) => <label key={user.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={participantIds.includes(user.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))}/>{user.name} · {user.department_name || "미지정"}</label>)}</div>{error ? <div style={{ color: "#b91c1c", marginTop: 12, fontSize: 12 }}>{error}</div> : null}<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}><button type="button" onClick={() => setParticipantsOpen(false)} style={button}>취소</button><button style={primary}>저장</button></div></form></div> : null}
    {createOpen ? <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 24, background: "rgba(15,23,42,.42)" }}><form onSubmit={submitRoom} style={{ width: "min(520px,100%)", maxHeight: "80vh", overflow: "auto", borderRadius: 18, background: "#fff", padding: 20 }}><header style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 22 }}>새 대화방</h2><button type="button" onClick={() => setCreateOpen(false)} style={button}>닫기</button></header><input required value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="대화방 이름" style={{ width: "100%", boxSizing: "border-box", height: 36, marginTop: 14, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 10px" }}/><div style={{ marginTop: 12, display: "grid", gap: 6 }}><strong>참여자 선택</strong>{directory.users.map((user) => <label key={user.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={participantIds.includes(user.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))}/>{user.name} · {user.department_name || "미지정"}</label>)}</div><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}><button type="button" onClick={() => setCreateOpen(false)} style={button}>취소</button><button style={primary}>생성</button></div></form></div> : null}
  </section>;
}
