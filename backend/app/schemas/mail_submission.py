from __future__ import annotations

from pydantic import BaseModel, SecretStr


class MailSubmissionCredentialView(BaseModel):
    userId: str
    username: str
    active: bool
    issuedAt: str | None = None
    revokedAt: str | None = None


class MailSubmissionCredentialIssueResponse(BaseModel):
    username: str
    password: SecretStr
    smtpHost: str
    smtpPort: int
    secure: bool
