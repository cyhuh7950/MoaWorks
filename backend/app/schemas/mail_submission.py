from __future__ import annotations

from pydantic import BaseModel


class MailSubmissionCredentialView(BaseModel):
    userId: str
    userName: str
    userEmail: str
    username: str
    active: bool
    issuedAt: str | None = None
    revokedAt: str | None = None


class MailSubmissionCredentialIssueResponse(BaseModel):
    username: str
    # 발급 직후 한 번만 관리자 화면에 전달하는 평문이다.
    # DB에는 해시만 저장하며, 조회 응답에는 이 필드를 포함하지 않는다.
    password: str
    smtpHost: str
    smtpPort: int
    secure: bool
