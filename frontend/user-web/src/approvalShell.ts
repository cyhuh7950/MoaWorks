import type { ApprovalDocument } from "./api";

export type ApprovalActualMenuKey = "pending" | "received" | "scheduled" | "personal";

export type ApprovalDocumentGroups = Record<ApprovalActualMenuKey, ApprovalDocument[]>;

export function classifyApprovalDocuments(
  documents: ApprovalDocument[],
  actorUserId: string,
): ApprovalDocumentGroups {
  const groups: ApprovalDocumentGroups = {
    pending: [],
    received: [],
    scheduled: [],
    personal: [],
  };

  if (!actorUserId) return groups;

  for (const document of documents) {
    const currentLine = document.currentLineIndex == null
      ? undefined
      : document.lines.find((line) => line.sequence === document.currentLineIndex);
    const isPending = document.status === "submitted"
      && currentLine?.approverUserId === actorUserId
      && currentLine.status === "pending";
    const isScheduled = document.status === "submitted"
      && document.currentLineIndex != null
      && document.lines.some((line) => (
        line.approverUserId === actorUserId
        && line.status === "pending"
        && line.sequence > document.currentLineIndex!
      ));
    const isReceived = document.creatorUserId !== actorUserId
      && document.lines.some((line) => (
        line.approverUserId === actorUserId
        && (line.status === "approved" || line.status === "rejected")
      ));
    const isPersonal = document.creatorUserId === actorUserId;

    if (isPending) groups.pending.push(document);
    if (isReceived) groups.received.push(document);
    if (isScheduled) groups.scheduled.push(document);
    if (isPersonal) groups.personal.push(document);
  }

  return groups;
}

export function findApprovalDocumentMenu(
  document: ApprovalDocument,
  actorUserId: string,
): ApprovalActualMenuKey | null {
  const groups = classifyApprovalDocuments([document], actorUserId);
  return (["pending", "received", "scheduled", "personal"] as const)
    .find((key) => groups[key].length > 0) ?? null;
}
