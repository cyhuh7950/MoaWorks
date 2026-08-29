function senderEmailId(email) {
  const trimmed = typeof email === "string" ? email.trim() : "";
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : null;
}

function resolveMailSenderDisplayMode(preferences) {
  const mode = preferences?.senderDisplayMode;
  return mode === "id" || mode === "name_email" ? mode : "name";
}

function formatMailSender(senderDisplayName, senderEmail, mode) {
  const displayName = typeof senderDisplayName === "string" && senderDisplayName.trim()
    ? senderDisplayName.trim()
    : "이름 정보 없음";
  if (mode === "id") return senderEmailId(senderEmail) ?? "ID 정보 없음";
  if (mode === "name_email") {
    const email = typeof senderEmail === "string" ? senderEmail.trim() : "";
    return email ? `${displayName} <${email}>` : displayName;
  }
  return displayName;
}

module.exports = {
  formatMailSender,
  resolveMailSenderDisplayMode,
  senderEmailId,
};
