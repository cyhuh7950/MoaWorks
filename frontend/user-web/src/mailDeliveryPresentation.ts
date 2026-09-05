const labels: Record<string, string> = {
  internal_delivered: "내부 전달 완료",
  queued: "외부 전달 대기",
  processing: "외부 전달 처리 중",
  retry_pending: "외부 전달 재시도 대기",
  sent: "상대 SMTP 수락 (수신함 도착 미확인)",
  blocked: "외부 발송 차단 (관리자 확인 필요)",
  failed: "전달 실패",
  result_unknown: "결과 확인 필요 (중복 전달 위험, 관리자 확인 필요)",
};
export function mailDeliveryLabel(status: string): string {
  return labels[status] ?? status;
}
export function mailSubmissionMessage(result: { internalCount: number; externalCount: number; queuedCount: number; blockedCount: number }): string {
  return `메일을 접수했습니다. 내부 전달 ${result.internalCount}건 / 외부 ${result.externalCount}건: 대기 ${result.queuedCount}건, 차단 ${result.blockedCount}건. 외부 수신함 도착은 확인되지 않았습니다.`;
}
