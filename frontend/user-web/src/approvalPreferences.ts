export const APPROVAL_WRITING_METHODS = [
  { value: "general", label: "일반 작성" },
] as const;

export const APPROVAL_ATTACHMENT_IMAGE_DISPLAYS = [
  { value: "thumbnail", label: "기본 사이즈로 표시" },
  { value: "original", label: "원본 사이즈로 표시" },
  { value: "filename", label: "파일명으로 표시" },
] as const;

export type ApprovalWritingMethod = typeof APPROVAL_WRITING_METHODS[number]["value"];
export type ApprovalAttachmentImageDisplay = typeof APPROVAL_ATTACHMENT_IMAGE_DISPLAYS[number]["value"];

export type ApprovalPreferenceDraft = {
  writingMethod: ApprovalWritingMethod;
  attachmentImageDisplay: ApprovalAttachmentImageDisplay;
  signatureName: string;
  removeSignature: boolean;
};

export function buildApprovalPreferenceSnapshot(value: ApprovalPreferenceDraft): string {
  return JSON.stringify(value);
}

export function shouldPreviewApprovalAttachment(
  contentType: string,
  display: ApprovalAttachmentImageDisplay,
): boolean {
  return contentType.toLowerCase().startsWith("image/") && display !== "filename";
}
