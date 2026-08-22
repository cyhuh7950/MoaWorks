const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot = path.join(projectRoot, "build-evidence");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(evidenceRoot, `local-storage-smoke-${runId}`);

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJson(fileName, payload) {
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function writeText(fileName, content) {
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

fs.mkdirSync(outputDir, { recursive: true });

const exportedAt = new Date().toISOString();
const mailArchive = {
  schemaVersion: "1.0",
  archiveType: "mail.local-archive",
  exportedAt,
  retentionPolicy: {
    server: "1개월",
    desktopLocal: "무기한",
  },
  mails: [
    {
      messageId: "mail-smoke-contract-review",
      subject: "3분기 계약 검토 요청",
      sender: "대표이사",
      receivedAt: exportedAt,
      flags: ["important", "archive-candidate"],
    },
  ],
};

const conversationArchive = {
  schemaVersion: "1.0",
  archiveType: "messenger.conversation",
  exportedAt,
  channelName: "제품 디자인 TF",
  retentionPolicy: {
    server: "2주",
    desktopLocal: "JSON/HTML 파일 보관",
  },
  messages: [
    { sender: "김팀장", sentAt: exportedAt, text: "오늘 승인 대기 문서 우선 처리 부탁드립니다." },
    { sender: "박과장", sentAt: exportedAt, text: "계약 검토 메일 첨부본을 채널에 다시 올렸습니다." },
  ],
};

const mailPath = writeJson(`moaworks-mail-archive-${runId}.json`, mailArchive);
const conversationJsonPath = writeJson(`moaworks-conversation-${runId}.json`, conversationArchive);
const conversationRows = conversationArchive.messages
  .map((item) => `<li><strong>${item.sender}</strong> <span>${item.sentAt}</span><p>${item.text}</p></li>`)
  .join("");
const conversationHtmlPath = writeText(
  `moaworks-conversation-${runId}.html`,
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${conversationArchive.channelName}</title></head><body><h1>${conversationArchive.channelName}</h1><p>보관 정책: 서버 ${conversationArchive.retentionPolicy.server}, 설치형 ${conversationArchive.retentionPolicy.desktopLocal}</p><ul>${conversationRows}</ul></body></html>`,
);

const manifest = {
  status: "success",
  outputDir: path.relative(projectRoot, outputDir),
  files: [mailPath, conversationJsonPath, conversationHtmlPath].map((filePath) => ({
    path: path.relative(projectRoot, filePath),
    size: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  })),
};

const manifestPath = path.join(outputDir, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

console.log("STATUS=success");
console.log(`OUTPUT_DIR=${manifest.outputDir}`);
for (const file of manifest.files) {
  console.log(`FILE=${file.path} SIZE=${file.size} SHA256=${file.sha256}`);
}
