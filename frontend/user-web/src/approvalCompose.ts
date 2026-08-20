export const APPROVAL_ATTACHMENT_MAX_COUNT = 10;
export const APPROVAL_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const APPROVAL_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

type DraftSummary = {
  title: string;
  content: string;
  attachmentCount: number;
  attachmentBytes: number;
};

type FileSummary = { name: string; size: number };

export function validateApprovalDraft(draft: DraftSummary): string[] {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push("결재 제목을 입력하세요.");
  else if (draft.title.trim().length > 200) errors.push("결재 제목은 200자 이내로 입력하세요.");
  if (!draft.content.trim()) errors.push("결재 본문을 입력하세요.");
  else if (draft.content.trim().length > 20000) errors.push("결재 본문은 20,000자 이내로 입력하세요.");
  if (draft.attachmentCount > APPROVAL_ATTACHMENT_MAX_COUNT) errors.push("첨부는 최대 10개까지 등록할 수 있습니다.");
  if (draft.attachmentBytes > APPROVAL_ATTACHMENT_MAX_TOTAL_BYTES) errors.push("첨부 전체 크기는 25MB를 초과할 수 없습니다.");
  return errors;
}

export function validateApprovalFiles(
  files: FileSummary[],
  currentCount: number,
  currentBytes: number,
): { ok: boolean; message: string } {
  if (files.some((file) => file.size <= 0)) return { ok: false, message: "빈 파일은 첨부할 수 없습니다." };
  if (files.some((file) => file.size > APPROVAL_ATTACHMENT_MAX_FILE_BYTES)) {
    return { ok: false, message: "첨부 파일 한 개는 10MB를 초과할 수 없습니다." };
  }
  if (currentCount + files.length > APPROVAL_ATTACHMENT_MAX_COUNT) {
    return { ok: false, message: "첨부는 최대 10개까지 등록할 수 있습니다." };
  }
  if (currentBytes + files.reduce((sum, file) => sum + file.size, 0) > APPROVAL_ATTACHMENT_MAX_TOTAL_BYTES) {
    return { ok: false, message: "첨부 전체 크기는 25MB를 초과할 수 없습니다." };
  }
  return { ok: true, message: "" };
}

export function moveApprovalApprover(ids: string[], userId: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(userId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function buildApprovalComposeSnapshot(
  form: {
    title: string; content: string; approverUserIds: string[];
    referenceUserIds: string[]; viewerUserIds: string[]; urgent: boolean; shareWithDepartment: boolean;
  },
  retainedAttachmentIds: string[],
  pendingFiles: FileSummary[],
): string {
  return JSON.stringify({
    title: form.title,
    content: form.content,
    approverUserIds: form.approverUserIds,
    referenceUserIds: form.referenceUserIds,
    viewerUserIds: form.viewerUserIds,
    urgent: form.urgent,
    shareWithDepartment: form.shareWithDepartment,
    retainedAttachmentIds,
    pendingFiles: pendingFiles.map((file) => [file.name, file.size]),
  });
}
