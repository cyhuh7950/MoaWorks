import type { ApprovalDocument } from "./api";

export type ApprovalActualMenuKey = "pending" | "received" | "reference" | "scheduled" | "personal" | "department" | "trash";
export type ApprovalPostAction = "create" | "edit" | "submit" | "withdraw" | "redraft" | "approve" | "reject";
export type ApprovalPostActionTarget = { menu: ApprovalActualMenuKey | null; documentId: string };
export type ApprovalDocumentGroups = Record<ApprovalActualMenuKey, ApprovalDocument[]>;

export function classifyApprovalDocuments(documents: ApprovalDocument[], actorUserId: string): ApprovalDocumentGroups {
  const groups: ApprovalDocumentGroups = { pending: [], received: [], reference: [], scheduled: [], personal: [], department: [], trash: [] };
  if (!actorUserId) return groups;
  for (const document of documents) {
    if (document.permanentlyDeletedForCurrentUser) continue;
    if (document.deletedForCurrentUser) { groups.trash.push(document); continue; }
    const currentLine = document.currentLineIndex == null ? undefined : document.lines.find((line) => line.sequence === document.currentLineIndex);
    const isPending = document.status === "submitted" && (document.canCurrentUserAct || currentLine?.approverUserId === actorUserId) && currentLine?.status === "pending";
    const isScheduled = document.status === "submitted" && document.currentLineIndex != null && document.lines.some((line) => (line.approverUserId === actorUserId || line.decidedByUserId === actorUserId) && line.status === "pending" && line.sequence > document.currentLineIndex!);
    const isReceived = document.creatorUserId !== actorUserId && document.lines.some((line) => line.approverUserId === actorUserId && (line.status === "approved" || line.status === "rejected"));
    if (isPending) groups.pending.push(document);
    if (isReceived) groups.received.push(document);
    if (document.currentUserAudienceType && !document.currentUserReadAt) groups.reference.push(document);
    if (isScheduled) groups.scheduled.push(document);
    if (document.creatorUserId === actorUserId) groups.personal.push(document);
    if (document.currentUserDepartmentMember) groups.department.push(document);
  }
  return groups;
}

export function findApprovalDocumentMenu(document: ApprovalDocument, actorUserId: string): ApprovalActualMenuKey | null {
  const groups = classifyApprovalDocuments([document], actorUserId);
  return (["trash", "pending", "reference", "received", "scheduled", "personal", "department"] as const).find((key) => groups[key].length > 0) ?? null;
}

export function resolveApprovalPostActionTarget(action: ApprovalPostAction, documentId: string, postActionDocument: ApprovalDocument | null, actorUserId: string): ApprovalPostActionTarget {
  if (action === "create" || action === "edit" || action === "submit" || action === "withdraw" || action === "redraft") return { menu: "personal", documentId };
  return { menu: postActionDocument ? findApprovalDocumentMenu(postActionDocument, actorUserId) : null, documentId };
}
