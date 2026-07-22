from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class MailAttachmentMeta(BaseModel):
    uploadId: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    fileName: str = Field(min_length=1, max_length=255)
    contentType: str = Field(default="application/octet-stream", max_length=255)
    sizeBytes: int = Field(default=0, gt=0)
    storageKey: str | None = Field(default=None, exclude=True)

    @model_validator(mode="after")
    def require_upload_reference(self):
        if not self.uploadId and not self.storageKey:
            raise ValueError("실제 업로드된 첨부만 사용할 수 있습니다.")
        return self


class MailAttachmentUploadResponse(BaseModel):
    uploadId: str
    fileName: str
    contentType: str
    sizeBytes: int = Field(gt=0)


class MailAttachmentView(BaseModel):
    attachmentId: str | None = None
    fileName: str
    contentType: str
    sizeBytes: int = Field(ge=0)


class MailSendRequest(BaseModel):
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str = Field(min_length=1)
    bodyText: str = Field(min_length=1)
    bodyHtml: str | None = None
    attachments: list[MailAttachmentMeta] = Field(default_factory=list, max_length=10)
    scheduledAt: datetime | None = None
    composeAction: Literal["new", "reply", "reply_all", "forward"] = "new"
    sourceMailId: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    copiedAttachmentIds: list[str] = Field(default_factory=list, max_length=10)

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

    @field_validator("copiedAttachmentIds")
    @classmethod
    def validate_copied_attachment_ids(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            attachment_id = value.strip()
            if not attachment_id or len(attachment_id) > 100:
                raise ValueError("전달 첨부 식별자가 올바르지 않습니다.")
            if not all(character.isalnum() or character in "_-" for character in attachment_id):
                raise ValueError("전달 첨부 식별자가 올바르지 않습니다.")

            if attachment_id not in normalized:
                normalized.append(attachment_id)
        return normalized
    @field_validator("scheduledAt")
    @classmethod
    def validate_scheduled_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("예약 발송 시각에는 timezone이 필요합니다.")
        normalized = value.astimezone(UTC)
        now = datetime.now(UTC)
        if normalized <= now + timedelta(minutes=1):
            raise ValueError("예약 발송은 현재보다 1분 이후여야 합니다.")
        if normalized > now + timedelta(days=365):
            raise ValueError("예약 발송은 365일 이내만 가능합니다.")
        return normalized

    @model_validator(mode="after")
    def dedupe_recipient_kinds(self):
        seen: set[str] = set()
        for field_name in ("to", "cc", "bcc"):
            values = [email for email in getattr(self, field_name) if email not in seen]
            setattr(self, field_name, values)
            seen.update(values)

        has_source = self.sourceMailId is not None
        if self.composeAction == "new" and (has_source or self.copiedAttachmentIds):
            raise ValueError("새 메일에는 원문 정보를 지정할 수 없습니다.")
        if self.composeAction != "new" and not has_source:
            raise ValueError("답장·전달에는 원문 메일이 필요합니다.")
        if self.composeAction != "forward" and self.copiedAttachmentIds:
            raise ValueError("원문 첨부는 전달에서만 복제할 수 있습니다.")
        return self


class MailDraftRequest(MailSendRequest):
    subject: str = Field(default="")
    bodyText: str = Field(default="")
    scheduledAt: None = None

    @model_validator(mode="after")
    def require_draft_content(self):
        if not (self.subject.strip() or self.bodyText.strip() or self.to or self.cc or self.bcc or self.attachments):
            raise ValueError("저장할 초안 내용이 없습니다.")
        return self


class MailRecentRecipient(BaseModel):
    email: str
    name: str | None = None
    departmentName: str | None = None
    lastUsedAt: datetime


class MailRecentRecipientListResponse(BaseModel):
    recipients: list[MailRecentRecipient]


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




class MailListQuery(BaseModel):
    q: str | None = Field(default=None, max_length=200)
    read: str = Field(default="all")
    starred: str = Field(default="all")
    attachment: str = Field(default="all")
    category: str = Field(default="all")
    sort: str = Field(default="date_desc")
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)

    @field_validator("q", mode="before")
    @classmethod
    def normalize_query(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("read", "starred", "attachment", "category", "sort")
    @classmethod
    def normalize_list_option(cls, value: str, info) -> str:
        normalized = value.strip().lower()
        allowed = {
            "read": {"all", "read", "unread"},
            "starred": {"all", "starred", "unstarred"},
            "attachment": {"all", "with", "without"},
            "category": {"all", "primary", "promotions", "social", "updates", "forums"},
            "sort": {"date_desc", "date_asc", "sender_asc", "subject_asc"},
        }
        if normalized not in allowed[info.field_name]:
            raise ValueError("지원하지 않는 메일 목록 조건입니다.")
        return normalized


class MailBulkRequest(BaseModel):
    mailIds: list[str] = Field(min_length=1, max_length=100)
    action: str = Field(min_length=1)
    mailbox: str = Field(default="inbox")
    targetCategory: str | None = None

    @field_validator("mailIds", mode="before")
    @classmethod
    def normalize_mail_ids(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            mail_id = str(value).strip()
            if not mail_id:
                raise ValueError("메일 ID는 비어 있을 수 없습니다.")
            if mail_id not in normalized:
                normalized.append(mail_id)
        return normalized

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"read", "unread", "star", "unstar", "move", "delete"}:
            raise ValueError("지원하지 않는 일괄 처리입니다.")
        return normalized

    @field_validator("mailbox")
    @classmethod
    def validate_mailbox(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"inbox", "sent", "draft"}:
            raise ValueError("지원하지 않는 메일함입니다.")
        return normalized

    @field_validator("targetCategory")
    @classmethod
    def validate_target_category(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in {"primary", "promotions", "social", "updates", "forums"}:
            raise ValueError("지원하지 않는 메일 분류입니다.")
        return normalized

    def validate_contract(self) -> None:
        allowed = {
            "inbox": {"read", "unread", "star", "unstar", "move", "delete"},
            "sent": {"delete"},
            "draft": {"delete"},
        }
        if self.action not in allowed[self.mailbox]:
            raise ValueError("해당 메일함에서 지원하지 않는 일괄 처리입니다.")
        if self.action == "move" and self.targetCategory is None:
            raise ValueError("분류 이동 대상이 필요합니다.")
        if self.action != "move" and self.targetCategory is not None:
            raise ValueError("분류 이동에서만 이동 대상을 지정할 수 있습니다.")


class MailBulkResponse(BaseModel):
    action: str
    requestedCount: int
    changedCount: int
    unchangedCount: int
    targetCategory: str | None = None

class MailSendResponse(BaseModel):
    mailId: str
    status: str
    sentAt: datetime | None = None
    scheduledAt: datetime | None = None


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
    previewText: str = ""
    status: str
    isRead: bool
    isStarred: bool
    sentAt: datetime | None = None
    scheduledAt: datetime | None = None
    receivedAt: datetime | None = None
    retentionExpiresAt: datetime | None = None
    attachmentCount: int
    category: str = "primary"


class MailListResponse(BaseModel):
    mails: list[MailSummary]
    total: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    hasMore: bool = False


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
    scheduledAt: datetime | None = None
    createdAt: datetime
    updatedAt: datetime
    retentionExpiresAt: datetime | None = None
    attachmentCount: int
    recipients: list[MailRecipientView]
    attachments: list[MailAttachmentView]


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
