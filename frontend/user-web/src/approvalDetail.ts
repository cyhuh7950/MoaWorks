export type ApprovalListDocument = {
  id: string;
  title: string;
  creatorUserName: string;
  status: string;
  currentLineIndex?: number;
  lines: Array<{ sequence: number; approverUserName: string; status: string }>;
};

export function approvalStatusLabel(status: string): string {
  return ({ draft: "초안", submitted: "상신", rejected: "반려", withdrawn: "회수", approved: "완료" } as Record<string, string>)[status] ?? status;
}

export function approvalLineStatusLabel(status: string): string {
  return ({ pending: "대기", approved: "승인", rejected: "반려" } as Record<string, string>)[status] ?? status;
}

export function filterApprovalDocuments<T extends ApprovalListDocument>(documents: T[], status: string, search: string): T[] {
  const keyword = search.trim().toLowerCase();
  return documents.filter((document) => {
    if (status !== "all" && document.status !== status) return false;
    const current = document.lines.find((line) => line.sequence === document.currentLineIndex);
    return !keyword || `${document.title} ${document.creatorUserName} ${current?.approverUserName ?? ""}`.toLowerCase().includes(keyword);
  });
}

export function resolveApprovalSelection(selectedId: string, documents: ApprovalListDocument[]): string {
  if (selectedId && documents.some((document) => document.id === selectedId)) return selectedId;
  return documents[0]?.id ?? "";
}
