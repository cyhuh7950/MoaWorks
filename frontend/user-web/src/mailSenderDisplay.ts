export type MailSenderDisplayMode = "name" | "id" | "name_email";

export function senderEmailId(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : null;
}

export function formatMailSender(
  senderDisplayName: string,
  senderEmail: string,
  mode: MailSenderDisplayMode,
): string {
  const displayName = senderDisplayName.trim() || "이름 정보 없음";
  if (mode === "name") return displayName;
  if (mode === "id") return senderEmailId(senderEmail) ?? "ID 정보 없음";
  const email = senderEmail.trim();
  return email ? `${displayName} <${email}>` : displayName;
}
