export const APPROVAL_DELEGATION_STATUS_LABELS = {
  disabled: "사용 안 함",
  scheduled: "예약",
  active: "사용 중",
  expired: "기간 종료",
} as const;

export type ApprovalDelegationDraft = {
  delegateUserId: string;
  startDate: string;
  endDate: string;
  reason: string;
  enabled: boolean;
};

export function buildApprovalDelegationSnapshot(value: ApprovalDelegationDraft): string {
  return JSON.stringify(value);
}

export function validateApprovalDelegation(value: ApprovalDelegationDraft): string {
  if (!value.startDate || !value.endDate) return "부재 기간을 입력하세요.";
  if (value.endDate < value.startDate) return "종료일은 시작일보다 빠를 수 없습니다.";
  if (!value.delegateUserId) return "대결자를 선택하세요.";
  const reason = value.reason.trim();
  if (!reason) return "부재 사유를 입력하세요.";
  if (reason.length > 500) return "부재 사유는 500자 이하로 입력하세요.";
  return "";
}
