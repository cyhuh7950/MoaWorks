from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Literal
import re
import unicodedata

from pydantic import BaseModel, Field, field_validator, model_validator


class MailBasicPreferencesBase(BaseModel):
    senderDisplayMode: Literal["name", "name_email"] = "name"
    blockRemoteImages: bool = True
    disableRiskyTags: bool = True
    showRouteCountry: bool = False
    includeSpamTrashInSearch: bool = False
    showListPreview: bool = False
    recipientInputMode: Literal["autocomplete", "name_only", "search"] = "autocomplete"
    confirmBeforeSend: bool = True
    saveSentCopy: bool = True
    readReceiptEnabled: bool = True
    editorMode: Literal["html", "plain"] = "html"
    composeMode: Literal["normal", "popup"] = "normal"
    messageEncoding: Literal["utf-8", "euc-kr", "iso-2022-jp"] = "utf-8"
    draftReminderEnabled: bool = False
    senderDisplayName: str = Field(default="", max_length=100)
    replyToEmail: str | None = Field(default=None, max_length=254)
    vcardEnabled: bool = False
    translationTargetLocale: str = Field(default="ko", min_length=2, max_length=20)
    translationComposeMode: Literal["preview", "apply"] = "preview"

    @field_validator("senderDisplayName")
    @classmethod
    def validate_sender_name(cls, value: str) -> str:
        if "\r" in value or "\n" in value:
            raise ValueError("발신자 이름에 줄바꿈을 사용할 수 없습니다.")
        return " ".join(value.split())

    @field_validator("replyToEmail")
    @classmethod
    def validate_reply_to(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().lower()
        if "\r" in normalized or "\n" in normalized or normalized.count("@") != 1 or any(character.isspace() for character in normalized):
            raise ValueError("답장 주소 형식이 올바르지 않습니다.")
        local, domain = normalized.split("@")
        local_pattern = r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
        domain_pattern = r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}"
        if not re.fullmatch(local_pattern, local, re.IGNORECASE) or not re.fullmatch(domain_pattern, domain, re.IGNORECASE):
            raise ValueError("답장 주소 형식이 올바르지 않습니다.")
        return normalized


class MailBasicPreferencesUpdateRequest(MailBasicPreferencesBase):
    expectedVersion: int = Field(ge=1)


class MailBasicPreferencesResponse(MailBasicPreferencesBase):
    version: int = Field(ge=1)
    updatedAt: datetime


class MailSignatureBase(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    contentText: str = Field(min_length=1, max_length=4000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if any(unicodedata.category(character).startswith("C") for character in value):
            raise ValueError("서명 이름에 제어문자를 사용할 수 없습니다.")
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("서명 이름을 입력하세요.")
        return normalized

    @field_validator("contentText")
    @classmethod
    def validate_content(cls, value: str) -> str:
        normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
        for character in normalized:
            if character not in ("\n", "\t") and unicodedata.category(character).startswith("C"):
                raise ValueError("서명 내용에 허용되지 않은 제어문자가 있습니다.")
        if not normalized:
            raise ValueError("서명 내용을 입력하세요.")
        if len(normalized) > 4000:
            raise ValueError("서명 내용은 4000자 이하여야 합니다.")
        return normalized


class MailSignatureCreateRequest(MailSignatureBase):
    makeDefault: bool = False


class MailSignatureUpdateRequest(MailSignatureBase):
    expectedVersion: int = Field(ge=1)


class MailSignatureView(MailSignatureBase):
    signatureId: str
    version: int = Field(ge=1)
    createdAt: datetime
    updatedAt: datetime


class MailSignaturePreferencesResponse(BaseModel):
    enabled: bool
    position: Literal["body_top", "body_bottom"]
    defaultSignatureId: str | None = None
    version: int = Field(ge=1)
    updatedAt: datetime
    signatures: list[MailSignatureView] = Field(default_factory=list)


class MailSignaturePreferencesUpdateRequest(BaseModel):
    enabled: bool
    position: Literal["body_top", "body_bottom"]
    defaultSignatureId: str | None = Field(default=None, min_length=1, max_length=100)
    expectedVersion: int = Field(ge=1)

    @model_validator(mode="after")
    def require_default_when_enabled(self):
        if self.enabled and not self.defaultSignatureId:
            raise ValueError("서명을 사용하려면 기본 서명이 필요합니다.")
        return self


class MailSignatureDeleteItem(BaseModel):
    signatureId: str = Field(min_length=1, max_length=100)
    expectedVersion: int = Field(ge=1)


class MailSignatureBulkDeleteRequest(BaseModel):
    items: list[MailSignatureDeleteItem] = Field(min_length=1, max_length=20)

    @field_validator("items")
    @classmethod
    def reject_duplicate_ids(cls, items: list[MailSignatureDeleteItem]) -> list[MailSignatureDeleteItem]:
        ids = [item.signatureId for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("중복된 서명 삭제 요청입니다.")
        return items


class MailAttachmentDispositionContract(BaseModel):
    disposition: Literal["attachment", "inline"] = "attachment"
    contentId: str | None = Field(default=None, max_length=255)

    @field_validator("contentId", mode="before")
    @classmethod
    def normalize_content_id(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def require_disposition_content_id_pair(self):
        if self.disposition == "inline" and not self.contentId:
            raise ValueError("인라인 첨부에는 비어 있지 않은 콘텐츠 ID가 필요합니다.")
        if self.disposition == "attachment" and self.contentId is not None:
            raise ValueError("일반 첨부에는 콘텐츠 ID를 지정할 수 없습니다.")
        return self


class MailAttachmentMeta(MailAttachmentDispositionContract):
    uploadId: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    fileName: str = Field(min_length=1, max_length=255)
    contentType: str = Field(default="application/octet-stream", max_length=255)
    sizeBytes: int = Field(default=0, gt=0)
    contentId: str | None = Field(default=None, max_length=255, exclude=True)
    storageKey: str | None = Field(default=None, exclude=True)

    @model_validator(mode="after")
    def require_upload_reference(self):
        if not self.uploadId and not self.storageKey:
            raise ValueError("실제 업로드된 첨부만 사용할 수 있습니다.")
        return self


class MailAttachmentUploadResponse(MailAttachmentDispositionContract):
    uploadId: str
    fileName: str
    contentType: str
    sizeBytes: int = Field(gt=0)
    previewPath: str | None = None


class MailAttachmentView(MailAttachmentDispositionContract):
    attachmentId: str | None = None
    fileName: str = Field(min_length=1)
    contentType: str = Field(default="application/octet-stream")
    sizeBytes: int = Field(default=0, ge=0)
    previewPath: str | None = None


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
    confirmed: bool = False

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


class MailScheduledUpdateRequest(MailSendRequest):
    scheduledAt: datetime
    attachments: list[MailAttachmentMeta] = Field(default_factory=list, max_length=10)
    sourceMailId: None = None
    copiedAttachmentIds: list[str] = Field(default_factory=list, max_length=0)
    confirmed: bool = True


class MailScheduledActionResponse(BaseModel):
    mailId: str
    status: Literal["scheduled", "draft", "sent"]
    scheduledAt: datetime | None = None
    sentAt: datetime | None = None



class MailDraftRequest(MailSendRequest):
    subject: str = Field(default="")
    bodyText: str = Field(default="")
    scheduledAt: None = None

    @model_validator(mode="after")
    def require_draft_content(self):
        if not (self.subject.strip() or self.bodyText.strip() or self.to or self.cc or self.bcc or self.attachments):
            raise ValueError("저장할 초안 내용이 없습니다.")
        return self


class MailDraftUpdateRequest(MailDraftRequest):
    retainedAttachmentIds: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("retainedAttachmentIds")
    @classmethod
    def validate_retained_attachment_ids(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            attachment_id = value.strip()
            if not attachment_id or len(attachment_id) > 100 or not all(character.isalnum() or character in "_-" for character in attachment_id):
                raise ValueError("유지할 첨부 식별자가 올바르지 않습니다.")
            if attachment_id not in normalized:
                normalized.append(attachment_id)
        return normalized


class MailRecentRecipient(BaseModel):
    recipientId: str | None = None
    email: str
    name: str | None = None
    departmentName: str | None = None
    lastUsedAt: datetime
    useCount: int = Field(default=1, ge=1)


class MailRecentRecipientListResponse(BaseModel):
    recipients: list[MailRecentRecipient]


class MailRecentRecipientSettingsResponse(BaseModel):
    recipients: list[MailRecentRecipient]
    totalCount: int = Field(ge=0)


class MailRecentRecipientBulkDeleteRequest(BaseModel):
    recipientIds: list[str] | None = Field(default=None, max_length=200)
    deleteAll: bool = False

    @model_validator(mode="after")
    def validate_selector(self):
        has_ids = self.recipientIds is not None
        if has_ids == self.deleteAll:
            raise ValueError("recipientIds 또는 deleteAll 중 하나만 지정해야 합니다.")
        if has_ids:
            if not self.recipientIds:
                raise ValueError("삭제할 최근 주소를 선택해야 합니다.")
            if any(not recipient_id.strip() or len(recipient_id) > 100 for recipient_id in self.recipientIds):
                raise ValueError("최근 주소 ID 형식이 올바르지 않습니다.")
            if len(self.recipientIds) != len(set(self.recipientIds)):
                raise ValueError("같은 최근 주소를 중복 선택할 수 없습니다.")
        return self


class MailRecentRecipientDeleteResponse(BaseModel):
    requestedCount: int = Field(ge=0)
    changedCount: int = Field(ge=0)


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



MAIL_TAG_COLORS = {"gray", "red", "orange", "yellow", "green", "blue", "purple"}


class MailFolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("메일함 이름을 입력해 주세요.")
        return normalized


class MailFolderUpdateRequest(MailFolderCreateRequest):
    pass


class MailFolderView(BaseModel):
    folderId: str
    name: str
    sortOrder: int = 0
    messageCount: int = 0


class MailFolderListResponse(BaseModel):
    folders: list[MailFolderView]


class MailTagCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    color: str = Field(default="gray")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("태그 이름을 입력해 주세요.")
        return normalized

    @field_validator("color")
    @classmethod
    def normalize_color(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in MAIL_TAG_COLORS:
            raise ValueError("지원하지 않는 태그 색상입니다.")
        return normalized


class MailTagUpdateRequest(MailTagCreateRequest):
    pass


class MailTagView(BaseModel):
    tagId: str
    name: str
    color: str
    sortOrder: int = 0
    messageCount: int = 0


class MailTagListResponse(BaseModel):
    tags: list[MailTagView]


class MailboxSettingsRow(BaseModel):
    mailboxKey: str
    name: str
    mailboxType: str
    retentionDays: Literal[30, 90, 180, 365] | None = None
    retentionEditable: bool
    unreadCount: int | None = Field(default=None, ge=0)
    totalCount: int = Field(ge=0)
    usedBytes: int = Field(ge=0)
    version: int = Field(ge=1)


class MailBackupJobView(BaseModel):
    jobId: str
    mailboxKey: str
    mailboxLabel: str
    status: Literal["queued", "running", "completed", "failed", "expired"]
    totalCount: int = Field(ge=0)
    processedCount: int = Field(ge=0)
    artifactSizeBytes: int = Field(ge=0)
    errorCode: str | None = None
    expiresAt: datetime | None = None


class MailMailboxSettingsResponse(BaseModel):
    mailboxes: list[MailboxSettingsRow]
    tags: list[MailTagView] = Field(default_factory=list)
    storage: MailStorageResponse
    backupJobs: list[MailBackupJobView] = Field(default_factory=list)


class MailMailboxPolicyUpdateRequest(BaseModel):
    retentionDays: Literal[30, 90, 180, 365] | None = None
    expectedVersion: int = Field(ge=1)


class MailMailboxEmptyRequest(BaseModel):
    expectedCount: int = Field(ge=0)
    confirmPermanent: bool = False


class MailMailboxEmptyResponse(BaseModel):
    mailboxKey: str
    changedCount: int = Field(ge=0)
    currentCount: int = Field(ge=0)


class MailBackupCreateRequest(BaseModel):
    mailboxKey: str = Field(min_length=1, max_length=120)


class MailBackupJobListResponse(BaseModel):
    jobs: list[MailBackupJobView]


class MailSpamPolicyUpdateRequest(BaseModel):
    filterEnabled: bool
    blockedAction: Literal["move_to_spam"] = "move_to_spam"
    expectedVersion: int = Field(ge=1)


class MailSpamRuleBase(BaseModel):
    ruleType: Literal["allow", "deny"]
    matchType: Literal["email", "domain"]
    matchValue: str = Field(min_length=1, max_length=320)
    enabled: bool = True

    @field_validator("matchValue")
    @classmethod
    def normalize_match_value_input(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("규칙 값을 입력해 주세요.")
        if any(unicodedata.category(character).startswith("C") for character in normalized):
            raise ValueError("규칙 값에 제어문자를 사용할 수 없습니다.")
        return normalized


class MailSpamRuleCreateRequest(MailSpamRuleBase):
    pass


class MailSpamRuleUpdateRequest(MailSpamRuleBase):
    pass


class MailSpamRuleView(BaseModel):
    ruleId: str
    ruleType: Literal["allow", "deny"]
    matchType: Literal["email", "domain"]
    matchValue: str
    enabled: bool
    createdAt: datetime
    updatedAt: datetime


class MailSpamSettingsResponse(BaseModel):
    filterEnabled: bool
    blockedAction: Literal["move_to_spam"]
    version: int = Field(ge=1)
    updatedAt: datetime
    rules: list[MailSpamRuleView] = Field(default_factory=list)


AutoConditionField = Literal["sender_email", "sender_domain", "recipient_email", "subject", "body", "attachment"]
AutoConditionOperator = Literal["equals", "contains", "subdomain", "starts_with", "ends_with", "exists", "missing"]


class MailAutoClassificationCondition(BaseModel):
    field: AutoConditionField
    operator: AutoConditionOperator
    value: str | None = Field(default=None, max_length=254)

    @model_validator(mode="after")
    def validate_combination(self):
        allowed = {
            "sender_email": {"equals", "contains"}, "recipient_email": {"equals", "contains"},
            "sender_domain": {"equals", "subdomain"},
            "subject": {"contains", "equals", "starts_with", "ends_with"},
            "body": {"contains"}, "attachment": {"exists", "missing"},
        }
        if self.operator not in allowed[self.field]:
            raise ValueError("지원하지 않는 자동분류 조건입니다.")
        if self.field == "attachment":
            if self.value not in (None, ""):
                raise ValueError("첨부 조건에는 값을 입력할 수 없습니다.")
            self.value = None
        elif not (self.value or "").strip():
            raise ValueError("조건 값을 입력해 주세요.")
        else:
            self.value = self.value.strip()
        return self


class MailAutoClassificationPolicyUpdateRequest(BaseModel):
    enabled: bool
    version: int = Field(ge=1)


class MailAutoClassificationRuleBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    conditions: list[MailAutoClassificationCondition] = Field(min_length=1, max_length=5)
    targetFolderId: str | None = Field(default=None, min_length=1, max_length=200)
    tagIds: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(unicodedata.category(ch).startswith("C") for ch in normalized):
            raise ValueError("규칙명을 확인해 주세요.")
        return normalized

    @field_validator("tagIds", mode="before")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values or []:
            normalized = str(value).strip()
            if not normalized:
                raise ValueError("태그 ID는 비어 있을 수 없습니다.")
            if normalized not in result:
                result.append(normalized)
        return result

    @model_validator(mode="after")
    def require_action(self):
        if not self.targetFolderId and not self.tagIds:
            raise ValueError("메일함 또는 태그 동작이 하나 이상 필요합니다.")
        return self


class MailAutoClassificationRuleCreateRequest(MailAutoClassificationRuleBase):
    pass


class MailAutoClassificationRuleUpdateRequest(MailAutoClassificationRuleBase):
    version: int = Field(ge=1)


class MailAutoClassificationRulesDeleteRequest(BaseModel):
    ruleIds: list[str] = Field(min_length=1, max_length=100)

    @field_validator("ruleIds")
    @classmethod
    def unique_ids(cls, values: list[str]) -> list[str]:
        normalized = [str(item).strip() for item in values]
        if any(not item for item in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("규칙 ID를 확인해 주세요.")
        return normalized


class MailAutoClassificationRulesOrderRequest(MailAutoClassificationRulesDeleteRequest):
    version: int = Field(ge=1)


class MailAutoClassificationLastEvent(BaseModel):
    result: Literal["applied", "matched_noop", "failed"]
    folderApplied: bool
    tagCount: int = Field(ge=0)
    reasonCode: str
    createdAt: datetime


class MailAutoClassificationRuleView(BaseModel):
    ruleId: str
    name: str
    enabled: bool
    priority: int
    version: int
    conditions: list[MailAutoClassificationCondition]
    targetFolderId: str | None
    tagIds: list[str]
    lastEvent: MailAutoClassificationLastEvent | None = None
    createdAt: datetime
    updatedAt: datetime


class MailAutoClassificationSettingsResponse(BaseModel):
    enabled: bool
    version: int = Field(ge=1)
    updatedAt: datetime
    rules: list[MailAutoClassificationRuleView] = Field(default_factory=list)
    folders: list[MailFolderView] = Field(default_factory=list)
    tags: list[MailTagView] = Field(default_factory=list)


def _normalize_forward_email_input(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 254 or normalized.count("@") != 1:
        raise ValueError("이메일 주소를 확인해 주세요.")
    local, domain = normalized.rsplit("@", 1)
    if not local or not domain or any(character.isspace() for character in normalized):
        raise ValueError("이메일 주소를 확인해 주세요.")
    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("이메일 주소를 확인해 주세요.") from exc
    result = f"{local}@{ascii_domain}"
    if len(result) > 254 or "." not in ascii_domain:
        raise ValueError("이메일 주소를 확인해 주세요.")
    return result


class MailAutoForwardPolicyUpdateRequest(BaseModel):
    enabled: bool
    keepOriginal: bool
    version: int = Field(ge=1)


class MailAutoForwardTargetsCreateRequest(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=10)

    @field_validator("emails", mode="before")
    @classmethod
    def normalize_emails(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values or []:
            normalized = _normalize_forward_email_input(str(value))
            if normalized not in result:
                result.append(normalized)
        return result


class MailAutoForwardTargetsDeleteRequest(BaseModel):
    targetIds: list[str] = Field(min_length=1, max_length=10)

    @field_validator("targetIds")
    @classmethod
    def unique_target_ids(cls, values: list[str]) -> list[str]:
        normalized = [str(item).strip() for item in values]
        if any(not item for item in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("전달 대상 ID를 확인해 주세요.")
        return normalized


class MailAutoForwardExceptionBase(BaseModel):
    matcherType: Literal["sender_email", "sender_domain"]
    matcherValue: str = Field(min_length=1, max_length=254)
    action: Literal["skip", "override"]
    targetEmails: list[str] = Field(default_factory=list, max_length=10)
    enabled: bool = True

    @field_validator("matcherValue")
    @classmethod
    def normalize_matcher(cls, value: str, info):
        normalized = value.strip().lower()
        matcher_type = info.data.get("matcherType")
        if matcher_type == "sender_email":
            return _normalize_forward_email_input(normalized)
        normalized = normalized.lstrip("@")
        if not normalized or "@" in normalized or len(normalized) > 253:
            raise ValueError("도메인을 확인해 주세요.")
        try:
            normalized = normalized.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise ValueError("도메인을 확인해 주세요.") from exc
        if "." not in normalized:
            raise ValueError("도메인을 확인해 주세요.")
        return normalized

    @field_validator("targetEmails", mode="before")
    @classmethod
    def normalize_targets(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values or []:
            normalized = _normalize_forward_email_input(str(value))
            if normalized not in result:
                result.append(normalized)
        return result

    @model_validator(mode="after")
    def validate_action_targets(self):
        if self.action == "override" and not self.targetEmails:
            raise ValueError("대체 전달 주소를 하나 이상 입력해 주세요.")
        if self.action == "skip" and self.targetEmails:
            raise ValueError("전달 안 함 규칙에는 전달 주소를 입력할 수 없습니다.")
        return self


class MailAutoForwardExceptionCreateRequest(MailAutoForwardExceptionBase):
    pass


class MailAutoForwardExceptionUpdateRequest(MailAutoForwardExceptionBase):
    version: int = Field(ge=1)


class MailAutoForwardExceptionsDeleteRequest(BaseModel):
    exceptionIds: list[str] = Field(min_length=1, max_length=100)

    @field_validator("exceptionIds")
    @classmethod
    def unique_exception_ids(cls, values: list[str]) -> list[str]:
        normalized = [str(item).strip() for item in values]
        if any(not item for item in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("예외 규칙 ID를 확인해 주세요.")
        return normalized


class MailAutoForwardLastResult(BaseModel):
    status: Literal["internal_delivered", "queued", "blocked", "retry_pending", "sent", "failed"]
    reasonCode: str
    createdAt: datetime


class MailAutoForwardTargetView(BaseModel):
    targetId: str
    email: str
    targetKind: Literal["internal", "external"]
    lastResult: MailAutoForwardLastResult | None = None


class MailAutoForwardExceptionView(BaseModel):
    exceptionId: str
    matcherType: Literal["sender_email", "sender_domain"]
    matcherValue: str
    action: Literal["skip", "override"]
    targetEmails: list[str]
    enabled: bool
    version: int = Field(ge=1)
    lastResult: MailAutoForwardLastResult | None = None
    createdAt: datetime
    updatedAt: datetime


class MailAutoForwardSettingsResponse(BaseModel):
    enabled: bool
    keepOriginal: bool
    version: int = Field(ge=1)
    updatedAt: datetime
    providerLocked: bool
    targets: list[MailAutoForwardTargetView] = Field(default_factory=list)
    exceptions: list[MailAutoForwardExceptionView] = Field(default_factory=list)


class MailOutOfOfficePolicyUpdateRequest(BaseModel):
    enabled: bool
    startDate: date | None
    endDate: date | None
    subject: str = Field(max_length=200)
    message: str = Field(max_length=4000)
    targetScope: Literal["all", "internal", "external"]
    version: int = Field(ge=1)


class MailOutOfOfficeLastResult(BaseModel):
    status: Literal["internal_delivered", "queued", "blocked", "retry_pending", "sent", "failed"]
    reasonCode: str
    createdAt: datetime


class MailOutOfOfficeSettingsResponse(BaseModel):
    enabled: bool
    startDate: date | None = None
    endDate: date | None = None
    subject: str
    message: str
    targetScope: Literal["all", "internal", "external"]
    version: int = Field(ge=1)
    state: Literal["disabled", "scheduled", "active", "expired"]
    lastResult: MailOutOfOfficeLastResult | None = None
    responseCount: int = Field(ge=0)
    providerLocked: bool
    updatedAt: datetime


class MailExternalAccountCreateRequest(BaseModel):
    displayName: str = Field(min_length=1, max_length=50)
    host: str = Field(min_length=1, max_length=253)
    port: int
    tlsMode: Literal["ssl", "starttls"]
    username: str = Field(min_length=1, max_length=254)
    password: str | None = Field(default=None, max_length=1000)
    targetFolderId: str | None = Field(default=None, max_length=200)
    deleteFromServer: bool = False
    enabled: bool = False

    @field_validator("displayName", "username")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("필수 입력값을 확인해 주세요.")
        return normalized


class MailExternalAccountUpdateRequest(MailExternalAccountCreateRequest):
    expectedVersion: int = Field(ge=1)


class MailExternalJobResultView(BaseModel):
    status: Literal["queued", "running", "completed", "partial", "failed"]
    importedCount: int = 0
    duplicateCount: int = 0
    deletedCount: int = 0
    failedCount: int = 0
    errorCode: str | None = None
    completedAt: datetime | None = None


class MailExternalAccountView(BaseModel):
    id: str
    display_name: str
    host: str
    port: int
    tls_mode: Literal["ssl", "starttls"]
    username: str
    target_folder_id: str | None = None
    delete_from_server: bool
    enabled: bool
    connection_status: Literal["untested", "success", "failed"]
    passwordConfigured: bool
    last_test_at: datetime | None = None
    last_test_code: str | None = None
    last_collect_at: datetime | None = None
    version: int
    created_at: datetime
    updated_at: datetime
    lastJob: MailExternalJobResultView | None = None


class MailExternalAccountListResponse(BaseModel):
    accounts: list[MailExternalAccountView]
    accountCount: int = Field(ge=0, le=5)
    activeJobCount: int = Field(ge=0)


class MailExternalCollectResponse(BaseModel):
    jobId: str
    status: Literal["queued"]


class MailExternalBulkDeleteRequest(BaseModel):
    accountIds: list[str] = Field(min_length=1, max_length=5)


class MailTrashSelection(BaseModel):
    mailId: str = Field(min_length=1, max_length=200)
    sourceMailbox: Literal["inbox", "sent", "draft"]

    @field_validator("mailId")
    @classmethod
    def normalize_mail_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("메일 ID는 비어 있을 수 없습니다.")
        return normalized

class MailBulkRequest(BaseModel):
    mailIds: list[str] = Field(min_length=1, max_length=100)
    action: str = Field(min_length=1)
    mailbox: str = Field(default="inbox")
    targetCategory: str | None = None
    targetFolderId: str | None = None
    targetTagId: str | None = None
    trashViews: list[MailTrashSelection] | None = Field(default=None, min_length=1, max_length=100)

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
        if normalized not in {"read", "unread", "star", "unstar", "move", "delete", "move_folder", "add_tag", "remove_tag", "spam", "not_spam", "restore", "purge"}:
            raise ValueError("지원하지 않는 일괄 처리입니다.")
        return normalized

    @field_validator("mailbox")
    @classmethod
    def validate_mailbox(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"inbox", "sent", "draft", "folder", "tag", "spam", "trash"}:
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

    @model_validator(mode="after")
    def validate_ui020_context(self):
        ui020_allowed = {
            "folder": {"read", "unread", "star", "unstar", "delete", "move_folder", "add_tag", "spam"},
            "tag": {"read", "unread", "star", "unstar", "delete", "move_folder", "add_tag", "remove_tag", "spam"},
            "spam": {"not_spam", "delete"},
            "trash": {"restore", "purge"},
        }
        if self.mailbox in ui020_allowed and self.action not in ui020_allowed[self.mailbox]:
            raise ValueError("해당 메일함에서 지원하지 않는 일괄 처리입니다.")
        return self
    def validate_contract(self) -> None:
        allowed = {
            "inbox": {"read", "unread", "star", "unstar", "move", "delete", "move_folder", "add_tag", "spam"},
            "folder": {"read", "unread", "star", "unstar", "delete", "move_folder", "add_tag", "spam"},
            "tag": {"read", "unread", "star", "unstar", "delete", "move_folder", "add_tag", "remove_tag", "spam"},
            "spam": {"not_spam", "delete"},
            "trash": {"restore", "purge"},
            "sent": {"delete"},
            "draft": {"delete"},
        }
        if self.action not in allowed[self.mailbox]:
            raise ValueError("해당 메일함에서 지원하지 않는 일괄 처리입니다.")
        if self.action == "move" and self.targetCategory is None:
            raise ValueError("분류 이동 대상이 필요합니다.")
        if self.action != "move" and self.targetCategory is not None:
            raise ValueError("분류 이동에서만 이동 대상을 지정할 수 있습니다.")
        if self.action == "move_folder" and not self.targetFolderId:
            raise ValueError("이동할 사용자 메일함이 필요합니다.")
        if self.action != "move_folder" and self.targetFolderId is not None:
            raise ValueError("메일함 이동에서만 대상 메일함을 지정할 수 있습니다.")
        if self.action in {"add_tag", "remove_tag"} and not self.targetTagId:
            raise ValueError("대상 태그가 필요합니다.")
        if self.action not in {"add_tag", "remove_tag"} and self.targetTagId is not None:
            raise ValueError("태그 처리에서만 대상 태그를 지정할 수 있습니다.")
        if self.mailbox == "trash":
            if not self.trashViews:
                raise ValueError("휴지통 처리에는 sourceMailbox가 포함된 선택 정보가 필요합니다.")
            selection_keys = [(item.mailId, item.sourceMailbox) for item in self.trashViews]
            if len(selection_keys) != len(set(selection_keys)):
                raise ValueError("같은 휴지통 view를 중복 선택할 수 없습니다.")
            if {item.mailId for item in self.trashViews} != set(self.mailIds):
                raise ValueError("휴지통 선택과 메일 ID가 일치하지 않습니다.")
        elif self.trashViews is not None:
            raise ValueError("휴지통 처리에서만 sourceMailbox 선택 정보를 사용할 수 있습니다.")

class MailBulkResponse(BaseModel):
    action: str
    requestedCount: int
    changedCount: int
    unchangedCount: int
    targetCategory: str | None = None
    targetFolderId: str | None = None
    targetTagId: str | None = None

class MailDeliveryOutcomeSummary(BaseModel):
    provider: str
    engineEnabled: bool
    internalRecipientCount: int = 0
    externalRecipientCount: int = 0
    queuedCount: int = 0
    sentCount: int = 0
    failedCount: int = 0
    retryPendingCount: int = 0


class MailSendResponse(BaseModel):
    mailId: str
    status: str
    sentAt: datetime | None = None
    deliverySummary: MailDeliveryOutcomeSummary | None = None


class MailRecipientView(BaseModel):
    recipientEmail: str
    recipientUserId: str | None = None
    recipientKind: str
    isRead: bool | None
    isStarred: bool | None
    receivedAt: datetime | None = None
    readAt: datetime | None = None


class MailSummary(BaseModel):
    mailId: str
    accountId: str | None
    senderEmail: str
    senderDisplayName: str = ""
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
    sourceMailbox: str | None = None


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


class MailExternalDeliveryStatus(BaseModel):
    queueId: str
    recipient: str
    provider: str
    status: str
    attemptCount: int
    lastError: str | None = None
    nextRetryAt: datetime | None = None
    sentAt: datetime | None = None


class MailDetailResponse(BaseModel):
    mailId: str
    accountId: str | None
    senderUserId: str | None
    senderEmail: str
    senderDisplayName: str = ""
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
    canViewReadReceipts: bool
    effectiveReadPolicy: dict[str, bool] = Field(default_factory=dict)
    recipients: list[MailRecipientView]
    attachments: list[MailAttachmentView]
    externalDeliveries: list[MailExternalDeliveryStatus] = Field(default_factory=list)


class MailDeliveryProviderView(BaseModel):
    providerId: str
    companyId: str
    providerKey: str
    enabled: bool
    senderDomain: str
    heloName: str
    senderAddress: str
    useTls: bool
    timeoutSec: int
    maxRetryCount: int
    retryIntervalSec: int
    createdAt: datetime
    updatedAt: datetime


class MailDeliveryQueueSummary(BaseModel):
    queuedCount: int = 0
    sendingCount: int = 0
    sentCount: int = 0
    failedCount: int = 0
    retryPendingCount: int = 0
    cancelledCount: int = 0


class MailDeliveryQueueItem(BaseModel):
    queueId: str
    mailId: str
    sender: str
    recipient: str
    subject: str
    provider: str
    status: str
    attemptCount: int
    lastError: str | None = None
    nextRetryAt: datetime | None = None
    sentAt: datetime | None = None
    createdAt: datetime
    updatedAt: datetime


class MailDeliveryAttemptItem(BaseModel):
    attemptId: str
    queueId: str
    status: str
    errorMessage: str | None = None
    responseDetail: str | None = None
    attemptedAt: datetime


class MailDeliveryEventItem(BaseModel):
    eventId: str
    queueId: str
    eventType: str
    message: str
    payload: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    createdAt: datetime


class MailDeliveryStatusResponse(BaseModel):
    provider: MailDeliveryProviderView
    summary: MailDeliveryQueueSummary


class MailDeliveryQueueResponse(BaseModel):
    provider: MailDeliveryProviderView
    summary: MailDeliveryQueueSummary
    queue: list[MailDeliveryQueueItem]
    attempts: list[MailDeliveryAttemptItem]
    events: list[MailDeliveryEventItem]


class MailDeliveryTestRequest(BaseModel):
    recipient: str = Field(min_length=3)
    subject: str = Field(default="MoaWorks SMTP 테스트")
    bodyText: str = Field(default="MoaWorks 자체 SMTP 엔진 테스트 메일입니다.")

    @field_validator("recipient")
    @classmethod
    def validate_recipient(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class MailDeliveryRetryResponse(BaseModel):
    queueItem: MailDeliveryQueueItem
    message: str


class MessengerRoomCreateRequest(BaseModel):
    roomName: str = Field(min_length=1, max_length=80)
    roomType: Literal["direct", "group"] = Field(default="group")
    participantUserIds: list[str] = Field(default_factory=list, max_length=100)
    translationLocale: Literal["ko", "en", "ja", "zh-cn", "es", "fr", "de"] = Field(default="ko")

    @field_validator("roomName")
    @classmethod
    def normalize_room_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("대화방 이름을 입력하세요.")
        return normalized

    @field_validator("translationLocale", mode="before")
    @classmethod
    def normalize_translation_locale(cls, value: str) -> str:
        return value.strip().replace("_", "-").lower()


class MessengerAttachmentMeta(BaseModel):
    uploadId: str = Field(pattern=r"^[0-9a-f]{32}$")
    fileName: str = Field(min_length=1, max_length=255)
    contentType: str = Field(min_length=1, max_length=255)
    sizeBytes: int = Field(gt=0)


class MessengerAttachmentUploadResponse(MessengerAttachmentMeta):
    pass


class MessengerAttachmentView(BaseModel):
    attachmentId: str
    fileName: str
    contentType: str
    sizeBytes: int


class MessengerRoomFavoriteRequest(BaseModel):
    isFavorite: bool


class MessengerRoomTranslationRequest(BaseModel):
    translationLocale: Literal["ko", "en", "ja", "zh-cn", "es", "fr", "de"]
    expectedUpdatedAt: datetime

    @field_validator("translationLocale", mode="before")
    @classmethod
    def normalize_translation_locale(cls, value: str) -> str:
        return value.strip().replace("_", "-").lower()


class MessengerRoomParticipantsRequest(BaseModel):
    participantUserIds: list[str] = Field(min_length=2, max_length=100)
    expectedUpdatedAt: datetime


class MessengerRoomOwnerTransferRequest(BaseModel):
    newOwnerUserId: str = Field(min_length=1, max_length=100)
    expectedUpdatedAt: datetime


class MessengerRoomLeaveResponse(BaseModel):
    roomId: str
    leftAt: datetime


class MessengerRoomDeleteResponse(BaseModel):
    roomId: str
    status: Literal["deleted"]
    deletedAt: datetime
    retentionExpiresAt: datetime


class MessengerMessageSendRequest(BaseModel):
    body: str = Field(default="", max_length=10000)
    messageType: Literal["text", "file"] = Field(default="text")
    attachments: list[MessengerAttachmentMeta] = Field(default_factory=list, max_length=10)
    attachmentMeta: list[dict] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_content(self):
        self.body = self.body.strip()
        if self.attachmentMeta:
            raise ValueError("실제 업로드된 첨부만 사용할 수 있습니다.")
        if not self.body and not self.attachments:
            raise ValueError("메시지 본문 또는 첨부 파일이 필요합니다.")
        return self


class MessengerRoomSummary(BaseModel):
    roomId: str
    roomType: str
    roomName: str
    translationLocale: str = "ko"
    participantIds: list[str]
    lastMessage: str | None = None
    lastMessageAt: datetime | None = None
    unreadCount: int = 0
    readState: str
    isFavorite: bool = False
    participantCount: int = 0
    createdByUserId: str
    canManageParticipants: bool = False
    canLeave: bool = True
    canDelete: bool = False
    status: str = "active"
    createdAt: datetime
    updatedAt: datetime
    retentionExpiresAt: datetime | None = None


class MessengerRoomListResponse(BaseModel):
    rooms: list[MessengerRoomSummary]


class AdminMessengerRoomView(BaseModel):
    roomId: str
    roomType: str
    roomName: str
    status: Literal["active", "deleted"]
    ownerUserId: str
    ownerUserName: str
    participantCount: int = 0
    messageCount: int = 0
    createdAt: datetime
    updatedAt: datetime
    closedAt: datetime | None = None
    retentionExpiresAt: datetime | None = None


class AdminMessengerRoomListResponse(BaseModel):
    rooms: list[AdminMessengerRoomView]
    total: int


class MessengerRoomDetailResponse(MessengerRoomSummary):
    participants: list[dict]


class MessengerMessageView(BaseModel):
    messageId: str
    roomId: str
    senderUserId: str
    senderUserName: str
    senderLocale: str = "ko-KR"
    messageType: str
    body: str
    attachmentMeta: list[dict]
    attachments: list[MessengerAttachmentView] = Field(default_factory=list)
    createdAt: datetime
    retentionExpiresAt: datetime | None = None
    readBy: list[str]
    readState: str
    recipientCount: int = 0
    readCount: int = 0
    unreadCount: int = 0


class MessengerMessageListResponse(BaseModel):
    messages: list[MessengerMessageView]
    nextCursor: datetime | None = None


class MessengerMessageSendResponse(BaseModel):
    messageId: str
    roomId: str
    createdAt: datetime


class MessengerReadResponse(BaseModel):
    roomId: str
    readAt: datetime
    lastReadMessageId: str | None = None


class ExternalDeliveryView(BaseModel):
    recipientEmail: str
    recipientKind: str
    status: str
    attemptCount: int = 0
    nextAttemptAt: datetime | None = None
    sentAt: datetime | None = None
    lastError: str | None = None

class MailDeliveryProviderUpdateRequest(BaseModel):
    deliveryEnabled: bool | None = None
    providerType: Literal["smtp", "ses", "oci_smtp"] | None = None
    relayHost: str | None = Field(default=None, min_length=1, max_length=255)
    relayPort: int | None = Field(default=None, ge=1, le=65535)
    tlsMode: Literal["none", "starttls", "tls"] | None = None
    fromAddress: str | None = Field(default=None, max_length=255)
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=1, max_length=1000)

class MailDeliveryProviderTestRequest(BaseModel):
    timeoutSeconds: int = Field(default=10, ge=1, le=30)

class MailDeliveryProviderView(BaseModel):
    providerId: str
    providerType: str
    relayHost: str
    relayPort: int
    tlsMode: str
    fromAddress: str | None = None
    deliveryEnabled: bool
    lastTestStatus: str
    lastConnectionAt: datetime | None = None
    lastConnectionError: str | None = None

class MailDeliveryQueueItem(BaseModel):
    queueId: str
    mailId: str
    recipientEmail: str
    subject: str
    status: str
    attemptCount: int
    nextAttemptAt: datetime | None = None
    leaseExpiresAt: datetime | None = None
    createdAt: datetime

class MailDeliveryAttemptView(BaseModel):
    attemptNumber: int
    result: str
    errorMessage: str | None = None
    relayResponse: str | None = None
    startedAt: datetime
    finishedAt: datetime

class MailDeliveryStatusResponse(BaseModel):
    provider: MailDeliveryProviderView
    worker: dict
    summary: dict[str, int]

class MailUserDeliveryProviderStatus(BaseModel):
    enabled: bool
    lastTestStatus: str

class MailUserDeliveryStatusResponse(BaseModel):
    provider: MailUserDeliveryProviderStatus

class MailDeliveryQueueListResponse(BaseModel):
    items: list[MailDeliveryQueueItem]
    total: int

class MailDeliveryQueueDetailResponse(BaseModel):
    item: MailDeliveryQueueItem
    attempts: list[MailDeliveryAttemptView]
    audits: list[dict]
