from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

class TranslationInput(BaseModel):
    locale: str
    content: str = Field(min_length=1)
class MessageCreate(BaseModel):
    key: str = Field(min_length=1)
    defaultLocale: str
    category: str
    translation: TranslationInput
    isSystem: bool = False
class MessagePatch(BaseModel):
    key: str | None = None
    defaultLocale: str | None = None
    category: str | None = None
    translations: list[TranslationInput] | None = None
class ContentBulkStatus(BaseModel):
    ids: list[str] = Field(min_length=1)
    status: Literal["active", "inactive", "published"]
class ContentBulkDelete(BaseModel):
    ids: list[str] = Field(min_length=1)
class HelpCreate(BaseModel):
    code: str
    title: str
    category: str
    audience: str
    content: str
    isSystem: bool = False
class HelpPatch(BaseModel):
    title: str | None = None
    category: str | None = None
    audience: str | None = None
    content: str | None = None
    status: str | None = None
class ContentList(BaseModel):
    items: list[dict]
    total: int
