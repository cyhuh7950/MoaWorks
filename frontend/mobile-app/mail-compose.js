function normalizeRecipient(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("수신자 이메일을 확인해 주세요.");
  }
  return email;
}

function buildMailSendPayload({ to, subject, bodyText } = {}) {
  const normalizedSubject = String(subject || "").trim();
  const normalizedBody = String(bodyText || "").trim();
  if (!normalizedSubject) throw new Error("메일 제목을 입력해 주세요.");
  if (!normalizedBody) throw new Error("메일 본문을 입력해 주세요.");
  return {
    to: [normalizeRecipient(to)],
    cc: [],
    bcc: [],
    subject: normalizedSubject,
    bodyText: normalizedBody,
    bodyHtml: null,
    attachments: [],
    scheduledAt: null,
    composeAction: "new",
    sourceMailId: null,
    copiedAttachmentIds: [],
    confirmed: true,
  };
}

function mailboxViewModel({ items = [], filter = "all", query = "" } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const rows = items.filter((item) => {
    const matchesQuery = !normalizedQuery
      || `${item.senderEmail || ""} ${item.subject || ""}`.toLowerCase().includes(normalizedQuery);
    const matchesFilter = filter === "all"
      || (filter === "unread" && !item.isRead)
      || (filter === "starred" && item.isStarred);
    return matchesQuery && matchesFilter;
  });
  return {
    primaryAction: "새 메일",
    tabs: ["받은메일함", "중요", "보낸메일함", "임시보관함"],
    rows,
  };
}

function mailboxRequestPath(mailbox) {
  const paths = {
    inbox: "/mail/inbox",
    starred: "/mail/inbox",
    sent: "/mail/sent",
    drafts: "/mail/drafts",
  };
  const path = paths[mailbox];
  if (!path) throw new Error("지원하지 않는 메일함입니다.");
  return path;
}

module.exports = {
  buildMailSendPayload,
  mailboxRequestPath,
  mailboxViewModel,
};
