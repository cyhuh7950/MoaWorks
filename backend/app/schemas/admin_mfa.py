from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EncryptedMfaSecret(BaseModel):
    model_config = ConfigDict(frozen=True)

    keyVersion: int = Field(gt=0)
    nonce: bytes = Field(min_length=12, max_length=12, repr=False)
    ciphertext: bytes = Field(min_length=1, repr=False)
    tag: bytes = Field(min_length=16, max_length=16, repr=False)


class AdminMfaMac(BaseModel):
    model_config = ConfigDict(frozen=True)

    keyVersion: int = Field(gt=0)
    mac: bytes = Field(min_length=32, max_length=32, repr=False)


class AdminMfaQrPng(BaseModel):
    model_config = ConfigDict(frozen=True)

    pngBytes: bytes = Field(min_length=8, repr=False)
    headers: dict[str, str]


class IssuedEmailOtp(BaseModel):
    model_config = ConfigDict(frozen=True)

    challengeId: str = Field(min_length=20)
    code: str = Field(pattern=r"^\d{6}$", repr=False)
    expiresAt: datetime
