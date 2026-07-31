const test = require("node:test");
const assert = require("node:assert/strict");

function loadArchiveService() {
  return require("../electron/archive-service.js");
}

const mailRequest = {
  kind: "mail",
  format: "json",
  suggestedFileName: "moaworks-mail-archive.json",
  payload: {
    archiveType: "mail.local-archive",
    mailbox: "inbox",
    mails: [{ messageId: "m1", subject: "제목", sender: "sender@example.invalid" }],
  },
};

const messengerRequest = {
  kind: "messenger",
  format: "html",
  suggestedFileName: "moaworks-conversation.html",
  payload: {
    archiveType: "messenger.conversation",
    channelName: "<운영 대화>",
    messages: [{ senderName: "<관리자>", bodyText: "<script>alert(1)</script>", createdAt: "2026-07-31T00:00:00Z" }],
  },
};

test("mail JSON archive validates its schema and serializes", () => {
  const { validateArchiveRequest, serializeArchive } = loadArchiveService();
  assert.equal(validateArchiveRequest(mailRequest).extension, ".json");
  const serialized = serializeArchive(mailRequest);
  assert.equal(JSON.parse(serialized).mails[0].messageId, "m1");
});

test("messenger HTML escapes title, sender and body", () => {
  const { serializeArchive } = loadArchiveService();
  const html = serializeArchive(messengerRequest);
  assert.match(html, /&lt;운영 대화&gt;/);
  assert.match(html, /&lt;관리자&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("archive rejects traversal, mismatched extensions, unknown formats and oversized content", () => {
  const { validateArchiveRequest } = loadArchiveService();
  assert.throws(() => validateArchiveRequest({ ...mailRequest, suggestedFileName: "../escape.json" }), /파일 이름/);
  assert.throws(() => validateArchiveRequest({ ...mailRequest, suggestedFileName: "mail.exe" }), /확장자/);
  assert.throws(() => validateArchiveRequest({ ...messengerRequest, format: "exe" }), /형식/);
  assert.throws(() => validateArchiveRequest({ ...mailRequest, payload: { ...mailRequest.payload, mails: [{ messageId: "m1", subject: "x".repeat(11_000_000), sender: "s" }] } }), /크기/);
});

test("saveArchive accepts only an absolute user-selected path with the approved extension", async () => {
  const writes = [];
  const { saveArchive } = loadArchiveService();
  const result = await saveArchive(mailRequest, {
    showSaveDialog: async () => ({ canceled: false, filePath: "C:\\Users\\Public\\Documents\\moaworks-mail-archive.json" }),
    writeFile: async (filePath, content) => writes.push({ filePath, content }),
  });
  assert.equal(result.saved, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0].filePath, /\.json$/);

  await assert.rejects(() => saveArchive(mailRequest, {
    showSaveDialog: async () => ({ canceled: false, filePath: "relative\\mail.json" }),
    writeFile: async () => {},
  }), /절대 경로/);
});

test("archive schema rejects missing payloads, invalid records and unsafe names", () => {
  const { validateArchiveRequest } = loadArchiveService();
  assert.throws(() => validateArchiveRequest({ ...mailRequest, payload: null }), /payload/);
  assert.throws(() => validateArchiveRequest({ ...mailRequest, payload: { archiveType: "wrong", mails: [] } }), /메일 archive/);
  assert.throws(() => validateArchiveRequest({ ...mailRequest, payload: { ...mailRequest.payload, mails: [{ messageId: 7, subject: "", sender: "" }] } }), /messageId/);
  assert.throws(() => validateArchiveRequest({ ...messengerRequest, payload: { archiveType: "wrong", messages: [] } }), /메신저 archive/);
  assert.throws(() => validateArchiveRequest({ ...messengerRequest, payload: { ...messengerRequest.payload, channelName: 7 } }), /channelName/);
  assert.throws(() => validateArchiveRequest({ ...mailRequest, suggestedFileName: "bad:name.json" }), /파일 이름/);
  assert.throws(() => validateArchiveRequest({ ...mailRequest, suggestedFileName: "" }), /파일 이름/);
});

test("messenger JSON supports renderer field aliases", () => {
  const { serializeArchive } = loadArchiveService();
  const request = {
    ...messengerRequest,
    format: "json",
    suggestedFileName: "conversation.json",
    payload: {
      archiveType: "messenger.conversation",
      channelName: "운영",
      messages: [{ sender: "담당자", text: "본문", sentAt: "2026-07-31" }],
    },
  };
  assert.equal(JSON.parse(serializeArchive(request)).messages[0].text, "본문");
});

test("saveArchive handles cancel and selected extension mismatch", async () => {
  const { saveArchive } = loadArchiveService();
  const canceled = await saveArchive(mailRequest, {
    showSaveDialog: async () => ({ canceled: true }),
    writeFile: async () => assert.fail("canceled save must not write"),
  });
  assert.deepEqual(canceled, { saved: false });
  await assert.rejects(() => saveArchive(mailRequest, {
    showSaveDialog: async () => ({ canceled: false, filePath: "C:\\Users\\Public\\mail.html" }),
    writeFile: async () => {},
  }), /선택한 archive 확장자/);
});
