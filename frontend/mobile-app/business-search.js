function normalizeBusinessSearchText(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, " ")
    .trim();
}

function displayText(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/gu, " ").trim();
}

function safeRecord(category, idValue, titleValue, summaryValues, targetScreen, indexValues) {
  const id = displayText(idValue);
  const title = displayText(titleValue);
  if (!id || !title) return null;
  const summaryParts = summaryValues.map(displayText).filter(Boolean);
  return {
    result: {
      category,
      id,
      title,
      summary: summaryParts.join(" · "),
      target: { screen: targetScreen, id },
    },
    index: normalizeBusinessSearchText([title, ...indexValues.map(displayText)].filter(Boolean).join(" ")),
  };
}

function sourceItems(value) {
  return Array.isArray(value) ? value : [];
}

const businessSearchSourceOrder = ["mail", "approval", "messenger", "schedule", "directory", "file"];

function updateBusinessSearchWarnings(currentWarnings, source, failed) {
  if (!businessSearchSourceOrder.includes(source)) {
    return sourceItems(currentWarnings).filter((item) => businessSearchSourceOrder.includes(item));
  }
  const next = new Set(sourceItems(currentWarnings).filter((item) => businessSearchSourceOrder.includes(item)));
  if (failed) next.add(source);
  else next.delete(source);
  return businessSearchSourceOrder.filter((item) => next.has(item));
}

function searchLoadedBusinessSummaries(query, sources = {}) {
  const tokens = normalizeBusinessSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const candidates = [];
  const add = (record) => {
    if (record && tokens.every((token) => record.index.includes(token))) candidates.push(record.result);
  };

  for (const item of sourceItems(sources.mailItems)) {
    if (!item || typeof item !== "object") continue;
    const preview = displayText(item.preview) || displayText(item.snippet);
    add(safeRecord("mail", item.mailId, item.subject, [item.senderEmail, preview], "mail", [item.senderEmail, preview]));
  }
  for (const item of sourceItems(sources.documents)) {
    if (!item || typeof item !== "object") continue;
    add(safeRecord("approval", item.id, item.title, [item.creatorUserName, item.status], "approval", [item.creatorUserName, item.status]));
  }
  for (const item of sourceItems(sources.rooms)) {
    if (!item || typeof item !== "object") continue;
    const lastMessage = displayText(item.lastMessage);
    add(safeRecord("messenger", item.roomId, item.roomName, [lastMessage || "최근 메시지 없음"], "chat", [lastMessage]));
  }
  for (const item of sourceItems(sources.schedules)) {
    if (!item || typeof item !== "object") continue;
    add(safeRecord("schedule", item.id, item.title, [item.starts_at, item.location, item.description], "calendar", [item.starts_at, item.ends_at, item.location, item.description]));
  }
  for (const item of sourceItems(sources.directoryUsers)) {
    if (!item || typeof item !== "object") continue;
    add(safeRecord("directory", item.id, item.name, [item.department_name, item.role_name, item.email], "directory", [item.department_name, item.role_name, item.email]));
  }
  for (const item of sourceItems(sources.files)) {
    if (!item || typeof item !== "object") continue;
    add(safeRecord("file", item.id, item.file_name, [item.content_type, item.status], "files", [item.content_type, item.status]));
  }

  const categoryOrder = { mail: 0, approval: 1, messenger: 2, schedule: 3, directory: 4, file: 5 };
  candidates.sort((left, right) => {
    const categoryDifference = categoryOrder[left.category] - categoryOrder[right.category];
    if (categoryDifference !== 0) return categoryDifference;
    const leftTitle = normalizeBusinessSearchText(left.title);
    const rightTitle = normalizeBusinessSearchText(right.title);
    if (leftTitle !== rightTitle) return leftTitle < rightTitle ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return candidates.slice(0, 50);
}

module.exports = {
  normalizeBusinessSearchText,
  searchLoadedBusinessSummaries,
  updateBusinessSearchWarnings,
};
