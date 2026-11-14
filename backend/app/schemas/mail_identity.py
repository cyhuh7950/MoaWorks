from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class MailDomainCreateRequest(BaseModel):
    domain: str = Field(min_length=3, max_length=253)


class MailDomainStatusRequest(BaseModel):
    status: Literal["pending", "active"]


class MailAddressCreateRequest(BaseModel):
    address: EmailStr


class MailAddressStatusRequest(BaseModel):
    active: bool
    sendRequested: bool = False
    sendEnabled: bool = False
