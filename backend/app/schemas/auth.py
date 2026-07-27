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
    accessToken: str
    tokenType: str
    expiresIn: int
    user: AuthUserSummary


class CurrentUserResponse(BaseModel):
    user: AuthUserSummary


class PasswordChangeRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def require_new_value(self):
        if self.currentPassword == self.newPassword:
            raise ValueError("새 비밀번호는 현재 비밀번호와 달라야 합니다.")
        return self


class PasswordChangeResponse(BaseModel):
    message: str
    user: AuthUserSummary
