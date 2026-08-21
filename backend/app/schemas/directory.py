from __future__ import annotations

from enum import Enum
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class CompanyRecord(BaseModel):
    id: str
    name: str
    domain: str
    status: str
    createdAt: datetime


class DepartmentRecord(BaseModel):
    id: str
    companyId: str
    systemDepartmentCode: str | None = None
    departmentCode: str | None = None
    name: str
    parentId: str | None = None
    status: str
    sortOrder: int = 100
    createdAt: datetime


class RoleRecord(BaseModel):
    id: str
    companyId: str
    name: str
    permissions: list[str]
    status: str
    createdAt: datetime


class UserRecord(BaseModel):
    id: str
    companyId: str
    email: str
    name: str
    passwordHash: str
    departmentId: str
    roleId: str
    status: str
    userType: str
    mustChangePassword: bool = False
    createdAt: datetime
    updatedAt: datetime


class MailAccountRecord(BaseModel):
    id: str
    userId: str
    email: str
    quotaMb: int
    status: str
    providerConfigId: str
    createdAt: datetime
    updatedAt: datetime


class MailProviderConfigRecord(BaseModel):
    id: str
    companyId: str
    providerType: str
    relayHost: str
    relayPort: int
    username: str
    encryptedPassword: str
    active: bool
    lastTestStatus: str
    lastTestMessage: str
    updatedAt: datetime


class MailProviderConfigView(BaseModel):
    id: str
    companyId: str
    providerType: str
    relayHost: str
    relayPort: int
    username: str
    active: bool
    lastTestStatus: str
    lastTestMessage: str
    updatedAt: datetime


class DirectoryState(BaseModel):
    companies: list[CompanyRecord]
    departments: list[DepartmentRecord]
    roles: list[RoleRecord]
    users: list[UserRecord]
    mailAccounts: list[MailAccountRecord]
    mailProviderConfigs: list[MailProviderConfigRecord]
    approvalDocuments: list[ApprovalDocumentRecord]
    approvalLines: list[ApprovalLineRecord]
    auditLogs: list[AuditLogRecord]


class AuthUserSummary(BaseModel):
    userId: str
    companyId: str
    userName: str
    userEmail: str
    roleId: str
    roleName: str
    userType: str
    status: str
    permissions: list[str]
    mustChangePassword: bool = False


class ApprovalStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class LineStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ApprovalActionReason(BaseModel):
    reason: str = Field(min_length=1)


class ApprovalDocumentRecord(BaseModel):
    id: str
    title: str
    content: str
    creatorUserId: str
    companyId: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    currentLineIndex: int | None = None
    submittedByUserId: str | None = None
    submittedAt: datetime | None = None


class ApprovalLineRecord(BaseModel):
    id: str
    documentId: str
    approverUserId: str
    approverUserName: str
    sequence: int
    status: str
    comment: str | None = None
    decidedByUserId: str | None = None
    decidedAt: datetime | None = None


class AuditLogRecord(BaseModel):
    id: str
    event: str
    actorUserId: str | None = None
    actorUserName: str
    targetType: str
    targetId: str
    statusBefore: str | None = None
    statusAfter: str | None = None
    reason: str | None = None
    createdAt: datetime


class ApprovalDocumentCreateRequest(BaseModel):
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    approverUserIds: list[str] = Field(default_factory=list)


class ApprovalDocumentUpdateRequest(BaseModel):
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    approverUserIds: list[str] = Field(default_factory=list)


class ApprovalApproverView(BaseModel):
    userId: str
    userName: str
    userEmail: str
    departmentName: str


class ApprovalApproverListResponse(BaseModel):
    users: list[ApprovalApproverView]


class ApprovalSubmitResponse(BaseModel):
    documentId: str


class ApprovalForceAction(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    reason: str = Field(min_length=1)


class ApprovalCreateResponse(BaseModel):
    documentId: str


class ApprovalLineActionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class ApprovalDocumentResponse(BaseModel):
    id: str
    title: str
    content: str
    creatorUserId: str
    creatorUserName: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    submittedByUserId: str | None = None
    submittedAt: datetime | None = None
    currentLineIndex: int | None = None
    lines: list[ApprovalLineRecord]


class ApprovalListResponse(BaseModel):
    documents: list[ApprovalDocumentResponse]


class AuditLogView(BaseModel):
    id: str
    event: str
    actorUserId: str | None = None
    actorUserName: str
    targetType: str
    targetId: str
    statusBefore: str | None = None
    statusAfter: str | None = None
    reason: str | None = None
    createdAt: datetime


class AuditLogListResponse(BaseModel):
    logs: list[AuditLogView]


class UserStatusIssue(BaseModel):
    code: str
    message: str


class DepartmentCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    parentId: str | None = None
    sortOrder: int = 100


class DepartmentUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    parentId: str | None = None
    sortOrder: int | None = None
    status: str | None = None


class RoleCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    permissions: list[str] | None = None
    status: str | None = None


class UserCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    loginId: str | None = None
    email: str | None = None
    password: str | None = Field(default=None, min_length=1)
    departmentId: str = Field(min_length=1)
    roleId: str = Field(min_length=1)
    status: str = Field(default="active")
    userType: str = Field(default="user")
    isDepartmentHead: bool = False

    @field_validator("loginId")
    @classmethod
    def validate_login_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("아이디를 입력해야 합니다.")
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-")
        if any(char not in allowed for char in normalized):
            raise ValueError("아이디는 영문 소문자, 숫자, 점(.), 하이픈(-), 밑줄(_)만 사용할 수 있습니다.")
        return normalized

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    password: str | None = Field(default=None, min_length=8)
    departmentId: str | None = None
    roleId: str | None = None
    status: str | None = None
    isDepartmentHead: bool | None = None


class UserView(BaseModel):
    userId: str
    companyId: str
    userName: str
    userEmail: str
    departmentId: str
    departmentName: str
    roleId: str
    roleName: str
    status: str
    userType: str
    isDepartmentHead: bool = False
    isDepartmentHead: bool = False
    mailAccountEmail: str
    mailAccountStatus: str
    permissions: list[str]
    consistencyIssues: list[UserStatusIssue]
    mustChangePassword: bool = False


class DirectoryOverviewResponse(BaseModel):
    company: CompanyRecord
    departments: list[DepartmentRecord]
    roles: list[RoleRecord]
    users: list[UserView]
    mailProvider: MailProviderConfigView


class OrgImportDepartmentPreview(BaseModel):
    rowNumber: int
    systemDepartmentCode: str
    departmentCode: str
    departmentName: str
    parentDepartmentCode: str | None = None
    parentDepartmentName: str | None = None
    sortOrder: int
    status: str


class OrgImportUserPreview(BaseModel):
    rowNumber: int
    loginId: str
    name: str
    departmentCode: str
    departmentName: str
    roleCode: str
    roleName: str
    status: str
    action: str


class OrgImportDeactivationPreview(BaseModel):
    userId: str
    loginId: str
    name: str
    email: str
    currentDepartmentName: str
    currentRoleName: str
    currentStatus: str
    reason: str


class OrgImportIssue(BaseModel):
    level: str
    rowNumber: int | None = None
    sheet: str | None = None
    message: str


OrgImportDeactivationScope = Literal["none", "uploaded_departments_only", "company_all"]


class OrgImportBatchResponse(BaseModel):
    batchId: str
    fileName: str
    uploadedByUserId: str | None = None
    uploadedByUserName: str
    validationStatus: str
    applyStatus: str
    deactivationScope: OrgImportDeactivationScope = "uploaded_departments_only"
    createdDepartmentCount: int
    movedUserCount: int
    createdUserCount: int
    deactivatedUserCount: int
    inactiveDepartmentCount: int
    errors: list[OrgImportIssue]
    warnings: list[OrgImportIssue]
    departments: list[OrgImportDepartmentPreview]
    users: list[OrgImportUserPreview]
    usersToDeactivate: list[OrgImportDeactivationPreview]
    protectedUsers: list[OrgImportDeactivationPreview] = Field(default_factory=list)
    uploadedAt: datetime
    appliedAt: datetime | None = None


class OrgImportApplyRequest(BaseModel):
    batchId: str = Field(min_length=1)
    confirmDeactivateMissingUsers: bool = False
    confirmationText: str | None = None


class DomainVerifyRequest(BaseModel):
    domain: str = Field(min_length=1)


class DomainVerifyItem(BaseModel):
    recordType: str
    host: str
    expectedValue: str
    status: str
    message: str


class DomainVerifyResponse(BaseModel):
    domain: str
    overallStatus: str
    checks: list[DomainVerifyItem]


class RelayTestRequest(BaseModel):
    providerConfigId: str | None = None
    testRecipient: str

    @field_validator("testRecipient")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class RelayTestResponse(BaseModel):
    providerConfigId: str
    status: str
    message: str
    testedAt: datetime
