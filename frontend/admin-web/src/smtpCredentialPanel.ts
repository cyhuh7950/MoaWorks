import type { DirectoryOverview, MailSubmissionCredential } from "./api";

type DirectoryUser = DirectoryOverview["users"][number];

export function getCredentialRows(
  users: DirectoryUser[],
  credentials: MailSubmissionCredential[],
): MailSubmissionCredential[] {
  const activeUsers = new Set(users.filter((user) => user.status === "active").map((user) => user.userId));
  return credentials.filter((credential) => credential.active && activeUsers.has(credential.userId));
}

export function getCredentialIssueCandidates(
  users: DirectoryUser[],
  credentials: MailSubmissionCredential[],
): DirectoryUser[] {
  const issuedUserIds = new Set(credentials.filter((credential) => credential.active).map((credential) => credential.userId));
  return users.filter((user) => user.status === "active" && !issuedUserIds.has(user.userId));
}
