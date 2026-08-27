export type MailSenderDisplayMode = "name" | "name_email";

function fallbackSenderName(senderEmail: string): string {
  const normalized = senderEmail.trim();
  const separator = normalized.indexOf("@");
  return (separator > 0 ? normalized.slice(0, separator) : normalized) || "알 수 없는 발신자";
}

export function formatMailSender(
  senderDisplayName: string,
  senderEmail: string,
  mode: MailSenderDisplayMode,
): string {
  const displayName = senderDisplayName.trim() || fallbackSenderName(senderEmail);
  if (mode === "name") return displayName;
  const email = senderEmail.trim();
  return email ? `${displayName} <${email}>` : displayName;
}
