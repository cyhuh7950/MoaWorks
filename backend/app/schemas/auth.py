from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.directory import AuthUserSummary


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class LoginResponse(BaseModel):
    nextAction: Literal["authenticated"] = "authenticated"
    accessToken: str
    tokenType: str
    expiresIn: int
    user: AuthUserSummary


class AdminMfaRequired(BaseModel):
    nextAction: Literal["mfa_required", "mfa_enrollment_required"]
    challengeId: str
    expiresAt: datetime


AuthLoginResponse = LoginResponse | AdminMfaRequired


class AdminMfaVerifyRequest(BaseModel):
    challengeId: str = Field(min_length=20, max_length=200)
    code: str = Field(pattern=r"^\d{6}$")


class AdminMfaRecoveryRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def validate_recovery_login_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class AdminMfaRecoveryRequested(BaseModel):
    challengeId: str
    expiresAt: datetime


class AdminMfaRecoveryVerifyRequest(BaseModel):
    challengeId: str | None = Field(default=None, min_length=20, max_length=200)
    code: str | None = Field(default=None, pattern=r"^\d{6}$")
    email: str | None = None
    recoveryCode: str | None = Field(default=None, min_length=20, max_length=200)

    @model_validator(mode="after")
    def validate_recovery_proof(self) -> "AdminMfaRecoveryVerifyRequest":
        email_otp = self.challengeId is not None and self.code is not None
        recovery_code = self.email is not None and self.recoveryCode is not None
        if email_otp == recovery_code:
            raise ValueError("이메일 OTP 또는 복구 코드 중 하나만 입력하세요.")
        if recovery_code:
            normalized = self.email.strip().lower()
            if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
                raise ValueError("이메일 형식이 올바르지 않습니다.")
            self.email = normalized
        return self


class AdminMfaReenrollRequired(BaseModel):
    nextAction: Literal["mfa_reenroll_required"] = "mfa_reenroll_required"
    challengeId: str
    expiresAt: datetime


class AdminMfaRecoveryEmailRequest(BaseModel):
    flowChallengeId: str | None = Field(default=None, min_length=20, max_length=200)
    recoveryEmail: str
    currentPassword: str | None = Field(default=None, min_length=1, max_length=128)
    currentTotp: str | None = Field(default=None, pattern=r"^\d{6}$")

    @field_validator("recoveryEmail")
    @classmethod
    def validate_recovery_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("복구 이메일 형식이 올바르지 않습니다.")
        return normalized


class AdminMfaRecoveryEmailRequested(BaseModel):
    challengeId: str
    expiresAt: datetime


class AdminMfaRecoveryEmailVerifyRequest(BaseModel):
    flowChallengeId: str | None = Field(default=None, min_length=20, max_length=200)
    verificationChallengeId: str = Field(min_length=20, max_length=200)
    recoveryEmail: str
    code: str = Field(pattern=r"^\d{6}$")

    @field_validator("recoveryEmail")
    @classmethod
    def validate_verified_recovery_email(cls, value: str) -> str:
        return AdminMfaRecoveryEmailRequest.validate_recovery_email(value)


class AdminMfaRecoveryEmailVerified(BaseModel):
    verified: Literal[True] = True


class AdminMfaTotpStartRequest(BaseModel):
    flowChallengeId: str | None = Field(default=None, min_length=20, max_length=200)
    verificationChallengeId: str | None = Field(default=None, min_length=20, max_length=200)


class AdminMfaTotpStartResponse(BaseModel):
    challengeId: str
    expiresAt: datetime
    manualKey: str = Field(min_length=16, max_length=128, pattern=r"^[A-Z2-7]+$")
    qrPath: str


class AdminMfaTotpQrRequest(BaseModel):
    challengeId: str = Field(min_length=20, max_length=200)


class AdminMfaTotpConfirmRequest(BaseModel):
    challengeId: str = Field(min_length=20, max_length=200)
    code: str = Field(pattern=r"^\d{6}$")


class AdminMfaEnrollmentCompleted(LoginResponse):
    recoveryCodes: list[str] = Field(min_length=1, max_length=20)


class AdminMfaStatusResponse(BaseModel):
    enrolled: bool
    status: Literal["not_enrolled", "pending", "active", "disabled"]
    recoveryEmailMasked: str | None = None
    profileVersion: int | None = None


class CurrentUserResponse(BaseModel):
    user: AuthUserSummary


class PasswordChangeRequest(BaseModel):
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_password_change(self) -> "PasswordChangeRequest":
        if self.currentPassword == self.newPassword:
            raise ValueError("새 비밀번호는 현재 비밀번호와 달라야 합니다.")
        return self


class PasswordChangeResponse(BaseModel):
    message: str
    user: AuthUserSummary
