from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class MailAttachmentMeta(BaseModel):
    fileName: str = Field(min_length=1)
    contentType: str = Field(default="application/octet-stream")
    sizeBytes: int = Field(default=0, ge=0)
    storageKey: str | None = None


class MailSendRequest(BaseModel):
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str = Field(min_length=1)
    bodyText: str = Field(min_length=1)
    bodyHtml: str | None = None
    attachments: list[MailAttachmentMeta] = Field(default_factory=list)

    @field_validator("to", "cc", "bcc")
    @classmethod
    def validate_emails(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            email = value.strip().lower()
            if "@" not in email or email.startswith("@") or email.endswith("@"):
                raise ValueError("이메일 형식이 올바르지 않습니다.")
            if email not in normalized:
                normalized.append(email)
        return normalized


class MailDraftRequest(MailSendRequest):
    bodyText: str = Field(default="")


class MailStatusResponse(BaseModel):
    mailId: str
    status: str
    isRead: bool | None = None
    isStarred: bool | None = None
    category: str | None = None


class MailCategoryRequest(BaseModel):
    category: str = Field(min_length=1)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"primary", "promotions", "social", "updates", "forums"}:
            raise ValueError("지원하지 않는 메일 분류입니다.")
        return normalized




class MailSendResponse(BaseModel):
    mailId: str
    status: str
    sentAt: datetime | None = None


class MailRecipientView(BaseModel):
    recipientEmail: str
    recipientUserId: str | None = None
    recipientKind: str
    isRead: bool
    isStarred: bool
    receivedAt: datetime | None = None
    readAt: datetime | None = None


class MailSummary(BaseModel):
    mailId: str
    accountId: str
    senderEmail: str
    subject: str
    status: str
    isRead: bool
    isStarred: bool
    sentAt: datetime | None = None
    receivedAt: datetime | None = None
    retentionExpiresAt: datetime | None = None
    attachmentCount: int
    category: str = "primary"


class MailListResponse(BaseModel):
    mails: list[MailSummary]


class MailStorageResponse(BaseModel):
    usedBytes: int = Field(ge=0)
    quotaBytes: int = Field(ge=0)
    usagePercent: float = Field(ge=0)


class MailDetailResponse(BaseModel):
    mailId: str
    accountId: str
    senderUserId: str
    senderEmail: str
    subject: str
    bodyText: str
    bodyHtml: str | None = None
    status: str
    sentAt: datetime | None = None
    createdAt: datetime
    updatedAt: datetime
    retentionExpiresAt: datetime | None = None
    attachmentCount: int
    recipients: list[MailRecipientView]
    attachments: list[MailAttachmentMeta]


class MessengerRoomCreateRequest(BaseModel):
    roomName: str = Field(min_length=1)
    roomType: str = Field(default="group")
    participantUserIds: list[str] = Field(default_factory=list)


class MessengerMessageSendRequest(BaseModel):
    body: str = Field(min_length=1)
    messageType: str = Field(default="text")
    attachmentMeta: list[dict] = Field(default_factory=list)


class MessengerRoomSummary(BaseModel):
    roomId: str
    roomType: str
    roomName: str
    participantIds: list[str]
    lastMessage: str | None = None
    lastMessageAt: datetime | None = None
    unreadCount: int = 0
    readState: str
    createdAt: datetime
    updatedAt: datetime
    retentionExpiresAt: datetime | None = None


class MessengerRoomListResponse(BaseModel):
    rooms: list[MessengerRoomSummary]


class MessengerRoomDetailResponse(MessengerRoomSummary):
    participants: list[dict]


class MessengerMessageView(BaseModel):
    messageId: str
    roomId: str
    senderUserId: str
    senderUserName: str
    messageType: str
    body: str
    attachmentMeta: list[dict]
    createdAt: datetime
    retentionExpiresAt: datetime | None = None
    readBy: list[str]
    readState: str


class MessengerMessageListResponse(BaseModel):
    messages: list[MessengerMessageView]


class MessengerMessageSendResponse(BaseModel):
    messageId: str
    roomId: str
    createdAt: datetime


class MessengerReadResponse(BaseModel):
    roomId: str
    readAt: datetime
    lastReadMessageId: str | None = None
