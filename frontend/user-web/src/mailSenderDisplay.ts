export type MailSenderDisplayMode = "name" | "name_email";

export function formatMailSender(
  senderDisplayName: string,
  senderEmail: string,
  mode: MailSenderDisplayMode,
): string {
  const displayName = senderDisplayName.trim() || "이름 정보 없음";
  if (mode === "name") return displayName;
  const email = senderEmail.trim();
  return email ? `${displayName} <${email}>` : displayName;
}
