import type { ApprovalDocument, MailSummary, MessengerRoomSummary, WorkspaceNotice, WorkspaceSchedule } from "./api";
import { FeedbackState } from "./components/FeedbackSystem";

type HomeTarget = "mail" | "approval" | "schedule" | "messenger" | "notices";
type Props = {
  userName: string;
  loading: boolean;
  error: string;
  mails: MailSummary[];
  approvals: ApprovalDocument[];
  schedules: WorkspaceSchedule[];
  rooms: MessengerRoomSummary[];
  notices: WorkspaceNotice[];
  onOpenList: (target: HomeTarget) => void;
  onOpenItem: (target: HomeTarget, id: string) => void;
};
type CardItem = { id: string; title: string; meta: string };
type Card = { key: HomeTarget; title: string; status: string; empty: string; items: CardItem[] };

function dateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function UserHome({ userName, loading, error, mails, approvals, schedules, rooms, notices, onOpenList, onOpenItem }: Props) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const unreadMails = mails.filter((item) => !item.isRead);
  const pendingApprovals = approvals.filter((item) => item.status === "submitted");
  const todaySchedules = schedules.filter((item) => { const start = new Date(item.starts_at); return !Number.isNaN(start.getTime()) && `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}` === todayKey; });
  const unreadRooms = rooms.filter((item) => item.unreadCount > 0);
  const unreadNotices = notices.filter((item) => !item.is_read);
  const cards: Card[] = [
    { key: "mail", title: "안 읽은 메일", status: `${unreadMails.length}건`, empty: "안 읽은 메일이 없습니다.", items: unreadMails.slice(0, 3).map((item) => ({ id: item.mailId, title: item.subject || "(제목 없음)", meta: `${item.senderEmail} · ${dateLabel(item.receivedAt)}` })) },
    { key: "approval", title: "결재 대기", status: `${pendingApprovals.length}건`, empty: "처리할 결재가 없습니다.", items: pendingApprovals.slice(0, 3).map((item) => ({ id: item.id, title: item.title, meta: `${item.creatorUserName} · ${item.status}` })) },
    { key: "schedule", title: "오늘 일정", status: `${todaySchedules.length}건`, empty: "오늘 예정된 일정이 없습니다.", items: todaySchedules.slice(0, 3).map((item) => ({ id: item.id, title: item.title, meta: dateLabel(item.starts_at) })) },
    { key: "messenger", title: "최근 대화", status: `${unreadRooms.length}개 안 읽음`, empty: "최근 대화가 없습니다.", items: rooms.slice(0, 3).map((item) => ({ id: item.roomId, title: item.roomName, meta: `${item.lastMessage || "최근 메시지 없음"} · ${dateLabel(item.lastMessageAt || item.updatedAt)}` })) },
    { key: "notices", title: "공지", status: `${unreadNotices.length}건 미확인`, empty: "게시된 공지가 없습니다.", items: notices.slice(0, 3).map((item) => ({ id: item.id, title: item.title, meta: `${item.author_name} · ${dateLabel(item.published_at)}` })) },
  ];

  return <section className="ui008-home" aria-label="사용자 홈">
    <header className="ui008-home-header">
      <div><span>오늘의 업무</span><h1>{userName}님, 확인할 업무입니다.</h1></div>
      <time dateTime={today.toISOString()}>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(today)}</time>
    </header>
    {loading ? <FeedbackState state="loading" title="업무 현황을 불러오는 중입니다." /> : null}
    {error ? <FeedbackState state="error" title="일부 업무 현황을 불러오지 못했습니다." message={error} /> : null}
    <div className="ui008-home-grid">
      {cards.map((card) => <article key={card.key} className={`ui008-home-card is-${card.key}`} data-home-card={card.key}>
        <header><button type="button" onClick={() => onOpenList(card.key)} aria-label={`${card.title} 목록 열기`}><span>{card.title}</span><strong>{card.status}</strong></button></header>
        <div className="ui008-home-items">
          {card.items.length ? card.items.map((item) => <button key={item.id} type="button" onClick={() => onOpenItem(card.key, item.id)}><strong>{item.title}</strong><span>{item.meta}</span></button>) : <p role="status">{card.empty}</p>}
        </div>
      </article>)}
    </div>
  </section>;
}
