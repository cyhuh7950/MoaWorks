from pydantic import BaseModel, Field, field_validator

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
