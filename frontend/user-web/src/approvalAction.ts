export type ApprovalActionType = "submit" | "approve" | "reject" | "withdraw" | "redraft";

export type ApprovalActionTone = "primary" | "success" | "danger" | "warning";

export type ApprovalActionConfig = {
  title: string;
  confirmLabel: string;
  expectedState: string;
  impact: string;
  tone: ApprovalActionTone;
  requiresOpinion: boolean;
};

export const APPROVAL_ACTION_CONFIG: Record<ApprovalActionType, ApprovalActionConfig> = {
  submit: {
    title: "상신 확인",
    confirmLabel: "상신",
    expectedState: "상신",
    impact: "첫 결재자에게 문서가 전달됩니다.",
    tone: "primary",
    requiresOpinion: false,
  },
  approve: {
    title: "승인",
    confirmLabel: "승인",
    expectedState: "다음 결재 또는 완료",
    impact: "다음 결재자가 있으면 전달되고 마지막 순번이면 완료됩니다.",
    tone: "success",
    requiresOpinion: true,
  },
  reject: {
    title: "반려",
    confirmLabel: "반려",
    expectedState: "반려",
    impact: "결재가 중단되며 작성자가 재기안할 수 있습니다.",
    tone: "danger",
    requiresOpinion: true,
  },
  withdraw: {
    title: "회수 확인",
    confirmLabel: "회수",
    expectedState: "회수",
    impact: "진행 중인 결재를 중단하고 작성자에게 반환합니다.",
    tone: "warning",
    requiresOpinion: false,
  },
  redraft: {
    title: "재기안 확인",
    confirmLabel: "재기안",
    expectedState: "초안",
    impact: "결재선의 처리 상태와 의견을 초기화하고 초안으로 전환합니다.",
    tone: "primary",
    requiresOpinion: false,
  },
};

export type ApprovalActionTarget = {
  documentId: string;
  title: string;
  status: string;
  currentApproverName: string;
  currentLineIndex: number | null;
  lineCount: number;
};

type ApprovalActionTargetSource = {
  id: string;
  title: string;
  status: string;
  currentLineIndex?: number | null;
  lines: Array<{ sequence: number; approverUserName: string; status: string }>;
};

export function buildApprovalActionTarget(document: ApprovalActionTargetSource): ApprovalActionTarget {
  const currentLineIndex = document.currentLineIndex ?? null;
  const currentLine = currentLineIndex == null
    ? undefined
    : document.lines.find((line) => line.sequence === currentLineIndex);
  return {
    documentId: document.id,
    title: document.title,
    status: document.status,
    currentApproverName: currentLine?.approverUserName ?? "-",
    currentLineIndex,
    lineCount: document.lines.length,
  };
}

export function validateApprovalActionOpinion(action: ApprovalActionType, opinion: string): string {
  if (!APPROVAL_ACTION_CONFIG[action].requiresOpinion) return "";
  const normalized = opinion.trim();
  if (!normalized) return action === "approve" ? "승인 의견을 입력하세요." : "반려 의견을 입력하세요.";
  if (normalized.length > 500) return "처리 의견은 500자 이내로 입력하세요.";
  return "";
}
