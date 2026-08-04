from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, SecretStr, field_validator, model_validator


class MailOperationsDomainUpdateRequest(BaseModel):
    registeredDomain: str = Field(min_length=3, max_length=253)
    mailDomain: str = Field(min_length=3, max_length=253)
    adminAccessMode: Literal["public", "restricted", "private"]
    adminAllowedCidrs: list[str] = Field(default_factory=list, max_length=100)


class MailOperationsProviderUpdateRequest(BaseModel):
    relayHost: str | None = Field(default=None, min_length=1, max_length=255)
    relayPort: int | None = Field(default=None, ge=1, le=65535)
    tlsMode: Literal["none", "starttls", "tls"] | None = None
    senderAddress: str | None = Field(default=None, max_length=255)
    username: str | None = Field(default=None, max_length=255)
    password: SecretStr | None = Field(default=None)
    deliveryEnabled: bool | None = None
    dkimDomain: str | None = Field(default=None, max_length=253)
    dkimSelector: str | None = Field(default=None, max_length=63)
    dkimPrivateKey: SecretStr | None = Field(default=None)

    @field_validator("relayHost", "senderAddress", "username", "dkimDomain", "dkimSelector", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_secret_lengths(self):
        if self.password is not None and not (1 <= len(self.password.get_secret_value()) <= 1000):
            raise ValueError("SMTP 비밀번호 길이가 올바르지 않습니다.")
        if self.dkimPrivateKey is not None and not (32 <= len(self.dkimPrivateKey.get_secret_value()) <= 16384):
            raise ValueError("DKIM 개인키 길이가 올바르지 않습니다.")
        return self


class MailOperationsProviderSwitchRequest(BaseModel):
    targetProvider: Literal["self_hosted", "oci_email_delivery"]


class MailOperationsProviderTestRequest(BaseModel):
    recipient: EmailStr
