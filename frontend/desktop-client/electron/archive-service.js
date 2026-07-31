const path = require("node:path");

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const ARCHIVE_CONTRACTS = Object.freeze({
  mail: Object.freeze({ json: ".json" }),
  messenger: Object.freeze({ json: ".json", html: ".html" }),
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateText(value, field, maxLength = 20_000) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${field} 형식이 올바르지 않습니다.`);
  }
}

function validatePayload(kind, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("archive payload 형식이 올바르지 않습니다.");
  }
  if (kind === "mail") {
    if (payload.archiveType !== "mail.local-archive" || !Array.isArray(payload.mails) || payload.mails.length > 5000) {
      throw new Error("메일 archive schema가 올바르지 않습니다.");
    }
    for (const mail of payload.mails) {
      validateText(mail?.messageId, "messageId", 512);
      validateText(mail?.subject || "", "subject");
      validateText(mail?.sender || "", "sender", 1024);
    }
    return;
  }
  if (payload.archiveType !== "messenger.conversation" || !Array.isArray(payload.messages) || payload.messages.length > 10_000) {
    throw new Error("메신저 archive schema가 올바르지 않습니다.");
  }
  validateText(payload.channelName, "channelName", 1024);
  for (const message of payload.messages) {
    validateText(message?.senderName ?? message?.sender ?? "", "senderName", 1024);
    validateText(message?.bodyText ?? message?.text ?? "", "bodyText");
    validateText(message?.createdAt ?? message?.sentAt ?? "", "createdAt", 128);
  }
}

function validateArchiveRequest(request) {
  const kind = String(request?.kind || "");
  const format = String(request?.format || "").toLowerCase();
  const contract = ARCHIVE_CONTRACTS[kind];
  if (!contract || !contract[format]) {
    throw new Error("허용되지 않은 archive 형식입니다.");
  }
  const suggestedFileName = String(request?.suggestedFileName || "");
  if (!suggestedFileName || suggestedFileName !== path.basename(suggestedFileName) || suggestedFileName.includes("..") || /[<>:"/\\|?*\0]/.test(suggestedFileName)) {
    throw new Error("archive 파일 이름이 올바르지 않습니다.");
  }
  const extension = contract[format];
  if (path.extname(suggestedFileName).toLowerCase() !== extension) {
    throw new Error("archive 확장자가 허용 형식과 일치하지 않습니다.");
  }
  const rawPayload = JSON.stringify(request?.payload);
  if (!rawPayload || Buffer.byteLength(rawPayload, "utf8") > MAX_ARCHIVE_BYTES) {
    throw new Error("archive 크기가 허용 범위를 초과했습니다.");
  }
  validatePayload(kind, request.payload);
  return { kind, format, extension, suggestedFileName, payload: request.payload };
}

function renderConversationHtml(payload) {
  const rows = payload.messages.map((message) => {
    const sender = message.senderName ?? message.sender ?? "";
    const createdAt = message.createdAt ?? message.sentAt ?? "";
    const body = message.bodyText ?? message.text ?? "";
    return `<li><strong>${escapeHtml(sender)}</strong> <span>${escapeHtml(createdAt)}</span><p>${escapeHtml(body)}</p></li>`;
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(payload.channelName)}</title></head><body><h1>${escapeHtml(payload.channelName)}</h1><ul>${rows}</ul></body></html>`;
}

function serializeArchive(request) {
  const validated = validateArchiveRequest(request);
  const content = validated.format === "html"
    ? renderConversationHtml(validated.payload)
    : JSON.stringify(validated.payload, null, 2);
  if (Buffer.byteLength(content, "utf8") > MAX_ARCHIVE_BYTES) {
    throw new Error("archive 크기가 허용 범위를 초과했습니다.");
  }
  return content;
}

async function saveArchive(request, dependencies) {
  const validated = validateArchiveRequest(request);
  const content = serializeArchive(request);
  const result = await dependencies.showSaveDialog({
    title: "MoaWorks archive 저장",
    defaultPath: validated.suggestedFileName,
    filters: [{ name: `${validated.kind} ${validated.format.toUpperCase()}`, extensions: [validated.extension.slice(1)] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  if (!path.isAbsolute(result.filePath)) {
    throw new Error("archive 저장 경로는 절대 경로여야 합니다.");
  }
  if (path.extname(result.filePath).toLowerCase() !== validated.extension) {
    throw new Error("선택한 archive 확장자가 허용 형식과 일치하지 않습니다.");
  }
  await dependencies.writeFile(result.filePath, content, "utf8");
  return { saved: true, filePath: result.filePath, bytes: Buffer.byteLength(content, "utf8") };
}

module.exports = {
  ARCHIVE_CONTRACTS,
  MAX_ARCHIVE_BYTES,
  escapeHtml,
  renderConversationHtml,
  saveArchive,
  serializeArchive,
  validateArchiveRequest,
};
