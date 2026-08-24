const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.resolve(__dirname, "..", "mail-compose.js");

function loadMailCompose() {
  assert.equal(fs.existsSync(modulePath), true, "mail compose model exists");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("새 메일 payload는 서버 계약만 정규화한다", () => {
  const { buildMailSendPayload } = loadMailCompose();

  assert.deepEqual(buildMailSendPayload({
    to: " User@Example.com ",
    subject: " 제목 ",
    bodyText: " 본문 ",
  }), {
    to: ["user@example.com"],
    cc: [],
    bcc: [],
    subject: "제목",
    bodyText: "본문",
    bodyHtml: null,
    attachments: [],
    scheduledAt: null,
    composeAction: "new",
    sourceMailId: null,
    copiedAttachmentIds: [],
    confirmed: true,
  });
});

test("새 메일 payload는 빈 값과 잘못된 이메일을 차단한다", () => {
  const { buildMailSendPayload } = loadMailCompose();

  assert.throws(() => buildMailSendPayload({ to: "invalid", subject: "제목", bodyText: "본문" }), /수신자/);
  assert.throws(() => buildMailSendPayload({ to: "user@example.com", subject: " ", bodyText: "본문" }), /제목/);
  assert.throws(() => buildMailSendPayload({ to: "user@example.com", subject: "제목", bodyText: " " }), /본문/);
});

test("메일 view model은 목업 액션·탭과 검색/필터 결과를 만든다", () => {
  const { mailboxViewModel } = loadMailCompose();
  const view = mailboxViewModel({
    items: [
      { mailId: "m1", senderEmail: "sender@example.com", subject: "회의", isRead: false, isStarred: true },
      { mailId: "m2", senderEmail: "other@example.com", subject: "공지", isRead: true, isStarred: false },
    ],
    filter: "unread",
    query: "회의",
  });

  assert.equal(view.primaryAction, "새 메일");
  assert.deepEqual(view.tabs, ["받은메일함", "중요", "보낸메일함", "임시보관함"]);
  assert.deepEqual(view.rows.map(({ mailId }) => mailId), ["m1"]);
});

test("메일함 탭은 서버의 기존 조회 경로에만 연결된다", () => {
  const { mailboxRequestPath } = loadMailCompose();

  assert.equal(mailboxRequestPath("inbox"), "/mail/inbox");
  assert.equal(mailboxRequestPath("starred"), "/mail/inbox");
  assert.equal(mailboxRequestPath("sent"), "/mail/sent");
  assert.equal(mailboxRequestPath("drafts"), "/mail/drafts");
  assert.throws(() => mailboxRequestPath("trash"), /지원하지 않는 메일함/);
});
