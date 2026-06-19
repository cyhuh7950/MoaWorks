from __future__ import annotations

import contextlib
import json
import os
import logging
import threading
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from collections.abc import Callable
from uuid import uuid4

from app.core.config import settings
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.schemas.directory import (
    AuditLogListResponse,
    AuditLogRecord,
    AuditLogView,
    AuthUserSummary,
    CompanyRecord,
    DepartmentRecord,
    DirectoryOverviewResponse,
    DirectoryState,
    ApprovalActionReason,
    ApprovalCreateResponse,
    ApprovalDocumentCreateRequest,
    ApprovalDocumentRecord,
    ApprovalDocumentResponse,
    ApprovalLineActionRequest,
    ApprovalLineRecord,
    ApprovalListResponse,
    MailAccountRecord,
    MailProviderConfigRecord,
    RoleRecord,
    UserCreateRequest,
    UserRecord,
    UserStatusIssue,
    UserUpdateRequest,
    UserView,
)
from app.services.security_service import SecurityService
from app.services.settings_store import SettingsStore
from app.services.observability_service import ObservabilityService

logger = logging.getLogger(__name__)


class DirectoryStore:
    _state_lock = threading.RLock()

    def __init__(self, state_file: Path | None = None) -> None:
        self.state_file = state_file or settings.directory_state_file
        self.settings_store = SettingsStore()
        self.security = SecurityService()
        self._state_cache: DirectoryState | None = None
        self._state_cache_mtime: float | None = None

    def _with_mutation(self, action: Callable[[DirectoryState], object]) -> object:
        with self._state_lock:
            with self._process_state_lock():
                state = self._load_state(mutable=True)
                result = action(state)
                self.save(state)
                return result

    def ensure_parent(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> DirectoryState:
        with self._state_lock:
            return self._load_state().model_copy(deep=True)

    def _load_state(self, mutable: bool = False) -> DirectoryState:
        state_file_exists = self.state_file.exists()
        current_mtime = self.state_file.stat().st_mtime if state_file_exists else None

        if self._state_cache is None or self._state_cache_mtime != current_mtime:
            if state_file_exists:
                data = json.loads(self.state_file.read_text(encoding="utf-8"))
                data = self._migrate_state(data)
                state = DirectoryState.model_validate(data)
            else:
                state = self._bootstrap_from_setup()
            self._state_cache = state
            self._state_cache_mtime = current_mtime

        if mutable:
            return self._state_cache
        return self._state_cache.model_copy(deep=True)

    def save(self, state: DirectoryState) -> None:
        if state is None:
            return
        self.ensure_parent()
        data = state.model_dump_json(indent=2)
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=str(self.state_file.parent),
            prefix=".moaworks-state-",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_file.write(data)
            tmp_path = Path(temp_file.name)
        tmp_path.replace(self.state_file)
        self._state_cache = state.model_copy(deep=True)
        self._state_cache_mtime = self.state_file.stat().st_mtime

    def get_overview(self) -> DirectoryOverviewResponse:
        state = self.load()
        company = state.companies[0]
        provider = state.mailProviderConfigs[0]
        return DirectoryOverviewResponse(
            company=company,
            departments=state.departments,
            roles=state.roles,
            users=[self._build_user_view(state, user) for user in state.users],
            mailProvider=provider,
        )

    def authenticate(self, email: str, password: str) -> AuthUserSummary:
        state = self.load()
        normalized = email.strip().lower()
        user = next((item for item in state.users if item.email.lower() == normalized), None)
        if user is None:
            raise ValueError("로그인 정보가 올바르지 않습니다.")
        if user.status != "active":
            raise PermissionError("비활성화된 계정입니다.")
        if not self.security.verify_password(password, user.passwordHash):
            raise ValueError("로그인 정보가 올바르지 않습니다.")

        self._assert_user_accessible(state, user)
        return self._to_auth_summary(state, user)

    def get_user_summary(self, user_id: str) -> AuthUserSummary:
        state = self.load()
        user = next((item for item in state.users if item.id == user_id), None)
        if user is None:
            raise ValueError("대상 사용자를 찾을 수 없습니다.")

        self._assert_user_accessible(state, user)
        return self._to_auth_summary(state, user)

    def create_department(self, name: str, parent_id: str | None, sort_order: int) -> DepartmentRecord:
        def _create_department(state: DirectoryState) -> DepartmentRecord:
            company = state.companies[0]
            department = DepartmentRecord(
                id=self._new_id("dept"),
                companyId=company.id,
                name=name.strip(),
                parentId=parent_id,
                status="active",
                sortOrder=sort_order,
                createdAt=self._now(),
            )
            state.departments.append(department)
            return department

        return self._with_mutation(_create_department)

    def create_role(self, name: str, permissions: list[str]) -> RoleRecord:
        def _create_role(state: DirectoryState) -> RoleRecord:
            company = state.companies[0]
            role = RoleRecord(
                id=self._new_id("role"),
                companyId=company.id,
                name=name.strip(),
                permissions=permissions or ["mail:read", "approval:read", "approval:create"],
                status="active",
                createdAt=self._now(),
            )
            state.roles.append(role)
            return role

        return self._with_mutation(_create_role)

    def create_user(self, payload: UserCreateRequest) -> UserView:
        def _create_user(state: DirectoryState) -> UserView:
            company = state.companies[0]
            normalized_email = payload.email.lower()
            if any(user.email.lower() == normalized_email for user in state.users):
                raise ValueError("이미 존재하는 이메일입니다.")

            department = self._get_department(state, payload.departmentId)
            role = self._get_role(state, payload.roleId)
            now = self._now()
            user = UserRecord(
                id=self._new_id("user"),
                companyId=company.id,
                email=normalized_email,
                name=payload.name.strip(),
                passwordHash=self.security.hash_password(payload.password),
                departmentId=department.id,
                roleId=role.id,
                status=payload.status,
                userType=payload.userType,
                createdAt=now,
                updatedAt=now,
            )
            provider = state.mailProviderConfigs[0]
            mail_account = MailAccountRecord(
                id=self._new_id("mail"),
                userId=user.id,
                email=normalized_email,
                quotaMb=2048,
                status="active" if payload.status == "active" else "inactive",
                providerConfigId=provider.id,
                createdAt=now,
                updatedAt=now,
            )
            self._append_audit(
                state=state,
                event="directory.user_created",
                actor=user,
                target_type="user",
                target_id=user.id,
                status_before=None,
                status_after="active",
            )
            state.users.append(user)
            state.mailAccounts.append(mail_account)
            return self._build_user_view(state, user)

        return self._with_mutation(_create_user)

    def update_user(self, user_id: str, payload: UserUpdateRequest) -> UserView:
        def _update_user(state: DirectoryState) -> UserView:
            user = next((item for item in state.users if item.id == user_id), None)
            if user is None:
                raise ValueError("대상 사용자를 찾을 수 없습니다.")
            previous_status = user.status

            if payload.name is not None:
                user.name = payload.name.strip()
            if payload.password is not None:
                user.passwordHash = self.security.hash_password(payload.password)
            if payload.departmentId is not None:
                self._get_department(state, payload.departmentId)
                user.departmentId = payload.departmentId
            if payload.roleId is not None:
                self._get_role(state, payload.roleId)
                user.roleId = payload.roleId
            if payload.status is not None:
                user.status = payload.status
                account = self._get_mail_account(state, user.id)
                account.status = "active" if payload.status == "active" else "inactive"
                account.updatedAt = self._now()

            user.updatedAt = self._now()
            self._append_audit(
                state=state,
                event="directory.user_updated",
                actor=user,
                target_type="user",
                target_id=user.id,
                status_before=previous_status,
                status_after=user.status,
            )
            return self._build_user_view(state, user)

        return self._with_mutation(_update_user)

    def update_relay_test_status(self, provider_config_id: str, status_value: str, message: str) -> MailProviderConfigRecord:
        def _update_relay(state: DirectoryState) -> MailProviderConfigRecord:
            provider = next((item for item in state.mailProviderConfigs if item.id == provider_config_id), None)
            if provider is None:
                raise ValueError("대상 Relay 설정을 찾을 수 없습니다.")
            provider.lastTestStatus = status_value
            provider.lastTestMessage = message
            provider.updatedAt = self._now()
            return provider

        return self._with_mutation(_update_relay)

    def get_provider(self, provider_config_id: str | None = None) -> MailProviderConfigRecord:
        state = self.load()
        if provider_config_id is None:
            return state.mailProviderConfigs[0]
        provider = next((item for item in state.mailProviderConfigs if item.id == provider_config_id), None)
        if provider is None:
            raise ValueError("대상 Relay 설정을 찾을 수 없습니다.")
        return provider

    def create_approval_document(self, actor_id: str, payload: ApprovalDocumentCreateRequest) -> ApprovalCreateResponse:
        def _create(state: DirectoryState) -> ApprovalCreateResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)

            approver_ids = self._normalize_unique_ids(payload.approverUserIds)
            if not approver_ids:
                raise ValueError("결재자는 최소 1명 이상 지정해야 합니다.")

            for approver_id in approver_ids:
                self._get_user_by_id(state, approver_id)
                if approver_id == actor_id:
                    raise ValueError("작성자는 결재선에서 제외해야 합니다.")

            now = self._now()
            document_id = self._new_id("doc")
            document = ApprovalDocumentRecord(
                id=document_id,
                title=payload.title.strip(),
                content=payload.content.strip(),
                creatorUserId=actor.id,
                companyId=actor.companyId,
                status="draft",
                createdAt=now,
                updatedAt=now,
                currentLineIndex=None,
                submittedByUserId=None,
                submittedAt=None,
            )
            state.approvalDocuments.append(document)

            for sequence, approver_id in enumerate(approver_ids):
                approver = self._get_user_by_id(state, approver_id)
                state.approvalLines.append(
                    ApprovalLineRecord(
                        id=self._new_id("line"),
                        documentId=document_id,
                        approverUserId=approver_id,
                        approverUserName=approver.name,
                        sequence=sequence,
                        status="pending",
                    )
                )
            self._append_audit(
                state=state,
                event="approval.document_created",
                actor=actor,
                target_type="approval_document",
                target_id=document_id,
                status_before=None,
                status_after="draft",
            )
            self._emit_observability_async(
                event_type="approval.status.changed",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.INFO,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document_id,
                title="결재 문서 작성됨",
                message=f"문서가 작성되어 대기 상태입니다. : {payload.title}",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document_id}:status:draft",
                payload={
                    "statusBefore": None,
                    "statusAfter": "draft",
                    "title": payload.title,
                    "creatorUserId": actor.id,
                    "lineUsers": approver_ids,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return ApprovalCreateResponse(documentId=document_id)

        return self._with_mutation(_create)

    def list_approval_documents(self, actor_id: str) -> ApprovalListResponse:
        state = self.load()
        actor = self._get_user_by_id(state, actor_id)
        self._assert_user_accessible(state, actor)

        documents: list = []
        for doc in sorted(state.approvalDocuments, key=lambda item: item.createdAt, reverse=True):
            if self._can_view_document(state, actor, doc):
                documents.append(self._build_document_response(state, doc))
        return ApprovalListResponse(documents=documents)

    def get_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        state = self.load()
        actor = self._get_user_by_id(state, actor_id)
        self._assert_user_accessible(state, actor)
        document = self._get_approval_document(state, document_id)
        if not self._can_view_document(state, actor, document):
            raise PermissionError("해당 문서를 조회할 권한이 없습니다.")
        return self._build_document_response(state, document)

    def submit_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        def _submit(state: DirectoryState) -> ApprovalDocumentResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)
            document = self._get_approval_document(state, document_id)
            if actor.id != document.creatorUserId:
                raise PermissionError("작성자만 상신할 수 있습니다.")
            if document.status != "draft":
                raise ValueError("작성 중 상태만 상신할 수 있습니다.")

            lines = self._get_document_lines(state, document.id)
            if not lines:
                raise ValueError("결재선을 지정하지 않아 상신할 수 없습니다.")

            self._assert_no_immutable_document(document)
            previous = document.status
            document.status = "submitted"
            document.submittedByUserId = actor.id
            document.submittedAt = self._now()
            document.currentLineIndex = 0
            document.updatedAt = self._now()
            self._append_audit(
                state=state,
                event="approval.submitted",
                actor=actor,
                target_type="approval_document",
                target_id=document.id,
                status_before=previous,
                status_after=document.status,
            )
            approver_ids = [item.approverUserId for item in lines]
            self._emit_observability_async(
                event_type="approval.submit",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.INFO,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 상신됨",
                message=f"문서가 상신 상태로 변경되었습니다. ({document.title})",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document.id}:submit",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "title": document.title,
                    "approverCount": len(approver_ids),
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            self._emit_observability_async(
                event_type="approval.status.changed",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.WARN,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 상태 변경",
                message=f"문서 상태가 {previous}에서 {document.status}로 변경되었습니다.",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document.id}:status:{document.status}",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "title": document.title,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return self._build_document_response(state, document)

        return self._with_mutation(_submit)

    def approve_approval_document(self, actor_id: str, document_id: str, payload: ApprovalLineActionRequest) -> ApprovalDocumentResponse:
        def _approve(state: DirectoryState) -> ApprovalDocumentResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)
            document = self._get_approval_document(state, document_id)
            if document.status != "submitted":
                raise ValueError("제출된 상태에서만 승인할 수 있습니다.")

            lines = self._get_document_lines(state, document.id)
            if not lines:
                raise ValueError("결재선 정보가 없습니다.")

            self._assert_no_immutable_document(document)
            current_line = self._get_current_line(document, lines)
            if current_line.approverUserId != actor.id:
                raise PermissionError("현재 결재자만 승인할 수 있습니다.")
            if current_line.status != "pending":
                raise ValueError("이미 처리된 결재 단계입니다.")

            current_line.status = "approved"
            current_line.decidedByUserId = actor.id
            current_line.decidedAt = self._now()
            current_line.comment = payload.reason

            self._move_next_step(document, lines)
            previous = document.status
            document.updatedAt = self._now()
            self._append_audit(
                state=state,
                event="approval.approved",
                actor=actor,
                target_type="approval_document",
                target_id=document.id,
                status_before=previous,
                status_after=document.status,
                reason=payload.reason,
            )
            approver_ids = [item.approverUserId for item in lines if item.approverUserId != actor.id]
            self._emit_observability_async(
                event_type="approval.status.changed",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.INFO,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 상태 변경",
                message=f"문서가 승인 처리되어 '{document.status}' 상태입니다.",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document.id}:status:{document.status}",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "action": "approve",
                    "reason": payload.reason,
                    "title": document.title,
                    "stepIndex": current_line.sequence,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return self._build_document_response(state, document)

        return self._with_mutation(_approve)

    def reject_approval_document(self, actor_id: str, document_id: str, payload: ApprovalLineActionRequest) -> ApprovalDocumentResponse:
        def _reject(state: DirectoryState) -> ApprovalDocumentResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)
            document = self._get_approval_document(state, document_id)
            if document.status != "submitted":
                raise ValueError("제출된 상태에서만 반려할 수 있습니다.")

            lines = self._get_document_lines(state, document.id)
            if not lines:
                raise ValueError("결재선 정보가 없습니다.")

            self._assert_no_immutable_document(document)
            current_line = self._get_current_line(document, lines)
            if current_line.approverUserId != actor.id:
                raise PermissionError("현재 결재자만 반려할 수 있습니다.")
            if current_line.status != "pending":
                raise ValueError("이미 처리된 결재 단계입니다.")

            previous = document.status
            current_line.status = "rejected"
            current_line.decidedByUserId = actor.id
            current_line.decidedAt = self._now()
            current_line.comment = payload.reason
            document.status = "rejected"
            document.currentLineIndex = None
            document.updatedAt = self._now()
            self._append_audit(
                state=state,
                event="approval.rejected",
                actor=actor,
                target_type="approval_document",
                target_id=document.id,
                status_before=previous,
                status_after=document.status,
                reason=payload.reason,
            )
            approver_ids = [item.approverUserId for item in lines if item.approverUserId != actor.id]
            self._emit_observability_async(
                event_type="approval.status.changed",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.WARN,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 반려",
                message=f"결재가 반려되어 문서가 '{document.status}' 상태가 되었습니다.",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document.id}:status:{document.status}",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "action": "reject",
                    "reason": payload.reason,
                    "title": document.title,
                    "stepIndex": current_line.sequence,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return self._build_document_response(state, document)

        return self._with_mutation(_reject)

    def withdraw_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        def _withdraw(state: DirectoryState) -> ApprovalDocumentResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)
            document = self._get_approval_document(state, document_id)
            if actor.id != document.creatorUserId:
                raise PermissionError("작성자만 회수할 수 있습니다.")
            if document.status != "submitted":
                raise ValueError("상신 중 문서만 회수할 수 있습니다.")

            previous = document.status
            document.status = "withdrawn"
            document.currentLineIndex = None
            document.updatedAt = self._now()
            self._append_audit(
                state=state,
                event="approval.withdrawn",
                actor=actor,
                target_type="approval_document",
                target_id=document.id,
                status_before=previous,
                status_after=document.status,
            )
            lines = self._get_document_lines(state, document.id)
            approver_ids = [item.approverUserId for item in lines]
            self._emit_observability_async(
                event_type="approval.withdraw",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.INFO,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 회수",
                message=f"문서가 회수되어 작성자 수정이 가능합니다. ({document.title})",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document.id}:withdrawn",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "title": document.title,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return self._build_document_response(state, document)

        return self._with_mutation(_withdraw)

    def rework_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        def _rework(state: DirectoryState) -> ApprovalDocumentResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)
            document = self._get_approval_document(state, document_id)
            if actor.id != document.creatorUserId:
                raise PermissionError("작성자만 재기안할 수 있습니다.")
            if document.status not in {"rejected", "withdrawn"}:
                raise ValueError("반려/회수 상태에서만 재기안할 수 있습니다.")

            lines = self._get_document_lines(state, document.id)
            for line in lines:
                line.status = "pending"
                line.decidedAt = None
                line.decidedByUserId = None
                line.comment = None

            self._assert_no_immutable_document(document)
            previous = document.status
            document.status = "draft"
            document.currentLineIndex = None
            document.submittedByUserId = None
            document.submittedAt = None
            document.updatedAt = self._now()
            self._append_audit(
                state=state,
                event="approval.redrafted",
                actor=actor,
                target_type="approval_document",
                target_id=document.id,
                status_before=previous,
                status_after=document.status,
            )
            approver_ids = [item.approverUserId for item in lines]
            self._emit_observability_async(
                event_type="approval.status.changed",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.INFO,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 재기안",
                message=f"문서가 재기안되어 'draft' 상태로 되돌아갔습니다. ({document.title})",
                targets=[actor.id, *approver_ids],
                dedup_key=f"approval:{document.id}:status:draft",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "title": document.title,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return self._build_document_response(state, document)

        return self._with_mutation(_rework)

    def admin_force_approve(self, actor_id: str, document_id: str, reason: ApprovalActionReason) -> ApprovalDocumentResponse:
        return self._admin_force(actor_id, document_id, reason, event="approval.admin_approved", final_status="approved")

    def admin_force_reject(self, actor_id: str, document_id: str, reason: ApprovalActionReason) -> ApprovalDocumentResponse:
        return self._admin_force(actor_id, document_id, reason, event="approval.admin_rejected", final_status="rejected")

    def get_audit_logs(self, actor_id: str, target_id: str | None = None) -> AuditLogListResponse:
        state = self.load()
        actor = self._get_user_by_id(state, actor_id)
        self._assert_user_accessible(state, actor)
        actor_role = self._get_role(state, actor.roleId)
        logs = [self._to_audit_view(item) for item in state.auditLogs]
        if "admin:*" not in actor_role.permissions:
            accessible_document_ids = self._collect_accessible_document_ids(state, actor)
            logs = [item for item in logs if item.targetType != "approval_document" or item.targetId in accessible_document_ids]
        if target_id:
            logs = [item for item in logs if item.targetId == target_id]
        return AuditLogListResponse(logs=list(reversed(logs)))

    def _admin_force(self, actor_id: str, document_id: str, reason: ApprovalActionReason, event: str, final_status: str) -> ApprovalDocumentResponse:
        def _force(state: DirectoryState) -> ApprovalDocumentResponse:
            actor = self._get_user_by_id(state, actor_id)
            self._assert_user_accessible(state, actor)
            document = self._get_approval_document(state, document_id)
            if document.status != "submitted":
                raise ValueError("직권 처리는 제출된 문서에서만 가능합니다.")
            self._assert_no_immutable_document(document)

            lines = self._get_document_lines(state, document.id)
            now = self._now()
            for line in lines:
                if final_status == "approved":
                    line.status = "approved"
                else:
                    line.status = "rejected"
                line.decidedByUserId = actor.id
                line.decidedAt = now
                line.comment = reason.reason

            previous = document.status
            document.status = final_status
            document.currentLineIndex = None
            if final_status == "approved":
                document.submittedAt = document.submittedAt or now
            document.updatedAt = now
            self._append_audit(
                state=state,
                event=event,
                actor=actor,
                target_type="approval_document",
                target_id=document.id,
                status_before=previous,
                status_after=document.status,
                reason=reason.reason,
            )
            approver_ids = self._collect_approver_ids(lines)
            self._emit_observability_async(
                event_type=f"approval.force.{final_status}",
                category=MonitoringCategory.APPROVAL,
                severity=SeverityLevel.ERROR if final_status == "rejected" else SeverityLevel.WARN,
                actor_user_id=actor.id,
                resource_type="approval_document",
                resource_id=document.id,
                title="결재 직권 처리",
                message=(
                    f"관리자 직권 처리로 문서가 '{document.status}'로 변경되었습니다. "
                    f"사유: {reason.reason}"
                ),
                targets=[actor.id, *approver_ids, document.creatorUserId],
                dedup_key=f"approval:{document.id}:force:{final_status}",
                payload={
                    "statusBefore": previous,
                    "statusAfter": document.status,
                    "reason": reason.reason,
                    "title": document.title,
                    "action": "admin_force",
                    "finalStatus": final_status,
                },
                visibility=Visibility.BOTH,
                source="directory-service",
            )
            return self._build_document_response(state, document)

        return self._with_mutation(_force)

    def _build_user_view(self, state: DirectoryState, user: UserRecord) -> UserView:
        department = self._get_department(state, user.departmentId)
        role = self._get_role(state, user.roleId)
        account = self._get_mail_account(state, user.id)
        return UserView(
            userId=user.id,
            companyId=user.companyId,
            userName=user.name,
            userEmail=user.email,
            departmentId=department.id,
            departmentName=department.name,
            roleId=role.id,
            roleName=role.name,
            status=user.status,
            userType=user.userType,
            mailAccountEmail=account.email,
            mailAccountStatus=account.status,
            permissions=role.permissions,
            consistencyIssues=self._validate_user_consistency(state, user),
        )

    def _validate_user_consistency(self, state: DirectoryState, user: UserRecord) -> list[UserStatusIssue]:
        issues: list[UserStatusIssue] = []
        role = self._get_role(state, user.roleId)
        account = self._get_mail_account(state, user.id)

        if role.status != "active":
            issues.append(UserStatusIssue(code="ROLE_INACTIVE", message="연결된 권한 역할이 비활성화 상태입니다."))
        if user.status == "active" and account.status != "active":
            issues.append(UserStatusIssue(code="MAIL_ACCOUNT_MISMATCH", message="활성 사용자이지만 메일 계정이 활성 상태가 아닙니다."))
        if user.status != "active" and account.status == "active":
            issues.append(UserStatusIssue(code="USER_INACTIVE_MAIL_ACTIVE", message="비활성 사용자이지만 메일 계정이 활성 상태입니다."))
        return issues

    def _get_department(self, state: DirectoryState, department_id: str) -> DepartmentRecord:
        department = next((item for item in state.departments if item.id == department_id), None)
        if department is None:
            raise ValueError("대상 부서를 찾을 수 없습니다.")
        return department

    def _get_role(self, state: DirectoryState, role_id: str) -> RoleRecord:
        role = next((item for item in state.roles if item.id == role_id), None)
        if role is None:
            raise ValueError("대상 권한을 찾을 수 없습니다.")
        return role

    def _get_mail_account(self, state: DirectoryState, user_id: str) -> MailAccountRecord:
        account = next((item for item in state.mailAccounts if item.userId == user_id), None)
        if account is None:
            raise ValueError("사용자 메일 계정을 찾을 수 없습니다.")
        return account

    def _get_user_by_id(self, state: DirectoryState, user_id: str) -> UserRecord:
        user = next((item for item in state.users if item.id == user_id), None)
        if user is None:
            raise ValueError("대상 사용자를 찾을 수 없습니다.")
        return user

    def _to_auth_summary(self, state: DirectoryState, user: UserRecord) -> AuthUserSummary:
        role = self._get_role(state, user.roleId)
        return AuthUserSummary(
            userId=user.id,
            companyId=user.companyId,
            userName=user.name,
            userEmail=user.email,
            roleId=role.id,
            roleName=role.name,
            userType=user.userType,
            status=user.status,
            permissions=role.permissions,
        )

    def _get_approval_document(self, state: DirectoryState, document_id: str) -> ApprovalDocumentRecord:
        document = next((item for item in state.approvalDocuments if item.id == document_id), None)
        if document is None:
            raise ValueError("결재 문서를 찾을 수 없습니다.")
        return document

    def _get_document_lines(self, state: DirectoryState, document_id: str) -> list[ApprovalLineRecord]:
        return sorted((item for item in state.approvalLines if item.documentId == document_id), key=lambda item: item.sequence)

    def _get_current_line(self, document: ApprovalDocumentRecord, lines: list[ApprovalLineRecord]) -> ApprovalLineRecord:
        if document.currentLineIndex is None:
            raise ValueError("현재 결재 단계가 없습니다.")
        for line in lines:
            if line.sequence == document.currentLineIndex:
                return line
        raise ValueError("현재 결재선을 찾을 수 없습니다.")

    def _move_next_step(self, document: ApprovalDocumentRecord, lines: list[ApprovalLineRecord]) -> None:
        if not lines:
            raise ValueError("결재선이 없습니다.")

        if all(item.status == "approved" for item in lines):
            document.status = "approved"
            document.currentLineIndex = None
            return

        for item in lines:
            if item.sequence <= (document.currentLineIndex or 0):
                continue
            if item.status == "pending":
                document.currentLineIndex = item.sequence
                return

        document.status = "approved"
        document.currentLineIndex = None

    def _can_view_document(self, state: DirectoryState, actor: UserRecord, document: ApprovalDocumentRecord) -> bool:
        actor_summary = self._to_auth_summary(state, actor)
        if "admin:*" in actor_summary.permissions:
            return True
        if document.creatorUserId == actor.id:
            return True
        lines = self._get_document_lines(state, document.id)
        return any(item.approverUserId == actor.id for item in lines)

    def _assert_user_accessible(self, state: DirectoryState, user: UserRecord) -> None:
        if user.status != "active":
            raise PermissionError("비활성화된 사용자 계정입니다.")
        role = self._get_role(state, user.roleId)
        if role.status != "active":
            raise PermissionError("사용자 권한이 비활성화된 상태입니다.")
        if self._get_mail_account(state, user.id).status != "active":
            raise PermissionError("사용자 계정 상태와 메일/권한 상태가 일치하지 않습니다.")

    def _build_document_response(self, state: DirectoryState, document: ApprovalDocumentRecord) -> ApprovalDocumentResponse:
        creator = self._get_user_by_id(state, document.creatorUserId)
        return ApprovalDocumentResponse(
            id=document.id,
            title=document.title,
            content=document.content,
            creatorUserId=document.creatorUserId,
            creatorUserName=creator.name,
            status=document.status,
            createdAt=document.createdAt,
            updatedAt=document.updatedAt,
            submittedByUserId=document.submittedByUserId,
            submittedAt=document.submittedAt,
            currentLineIndex=document.currentLineIndex,
            lines=self._get_document_lines(state, document.id),
        )

    def _to_audit_view(self, item: AuditLogRecord) -> AuditLogView:
        return AuditLogView(
            id=item.id,
            event=item.event,
            actorUserId=item.actorUserId,
            actorUserName=item.actorUserName,
            targetType=item.targetType,
            targetId=item.targetId,
            statusBefore=item.statusBefore,
            statusAfter=item.statusAfter,
            reason=item.reason,
            createdAt=item.createdAt,
        )

    def _collect_accessible_document_ids(self, state: DirectoryState, actor: UserRecord) -> set[str]:
        return {item.id for item in self._list_accessible_documents(state, actor)}

    def _list_accessible_documents(self, state: DirectoryState, actor: UserRecord) -> list[ApprovalDocumentRecord]:
        return [
            document
            for document in state.approvalDocuments
            if self._can_view_document(state, actor, document)
        ]

    def _collect_approver_ids(self, lines: list[ApprovalLineRecord]) -> list[str]:
        return [item.approverUserId for item in lines]

    def _append_audit(
        self,
        *,
        state: DirectoryState,
        event: str,
        actor: UserRecord,
        target_type: str,
        target_id: str,
        status_before: str | None,
        status_after: str | None,
        reason: str | None = None,
    ) -> None:
        state.auditLogs.append(
            AuditLogRecord(
                id=self._new_id("log"),
                event=event,
                actorUserId=actor.id,
                actorUserName=actor.name,
                targetType=target_type,
                targetId=target_id,
                statusBefore=status_before,
                statusAfter=status_after,
                reason=reason,
                createdAt=self._now(),
            )
        )

    def _emit_observability_async(
        self,
        *,
        event_type: str,
        category: MonitoringCategory,
        severity: SeverityLevel,
        actor_user_id: str,
        resource_type: str,
        resource_id: str,
        title: str,
        message: str,
        targets: list[str] | None = None,
        dedup_key: str | None = None,
        request_id: str | None = None,
        payload: dict[str, object] | None = None,
        visibility: Visibility = Visibility.ADMIN,
        source: str = "directory-service",
    ) -> None:
        request_id = request_id or f"req_{uuid4().hex}"
        event = EventEnvelope(
            eventId=f"evt_{uuid4().hex}",
            eventType=event_type,
            category=category,
            severity=severity,
            resourceType=resource_type,
            resourceId=resource_id,
            requestId=request_id,
            dedupKey=dedup_key or f"{event_type}:{resource_type}:{resource_id}",
            title=title,
            message=message,
            source=source,
            companyId="cmp_default",
            actorUserId=actor_user_id,
            occurredAt=datetime.now(UTC),
            createdAt=datetime.now(UTC),
            targets=targets or [],
            visibility=visibility,
            payload=payload or {},
        )

        def _runner() -> None:
            try:
                ObservabilityService().emit_event(event)
            except Exception as exc:
                logger.warning(
                    "observability.emit_failed",
                    extra={"event_type": event.eventType, "resource_id": resource_id, "error": str(exc)},
                )

        threading.Thread(target=_runner, daemon=True).start()

    def _assert_no_immutable_document(self, document: ApprovalDocumentRecord) -> None:
        if document.status == "approved":
            raise ValueError("승인 완료 문서는 수정할 수 없습니다.")

    @staticmethod
    def _normalize_unique_ids(values: list[str]) -> list[str]:
        deduped: list[str] = []
        for value in values:
            item = value.strip()
            if not item or item in deduped:
                continue
            deduped.append(item)
        return deduped

    @staticmethod
    def _migrate_state(data: dict) -> dict:
        changed = False
        if "approvalDocuments" not in data:
            data["approvalDocuments"] = []
            changed = True
        if "approvalLines" not in data:
            data["approvalLines"] = []
            changed = True
        if "auditLogs" not in data:
            data["auditLogs"] = []
            changed = True
        if changed:
            pass
        return data

    def _bootstrap_from_setup(self) -> DirectoryState:
        setup = self.settings_store.load()
        if setup is None or not setup.initialized:
            raise ValueError("초기 설정이 완료되지 않았습니다.")

        now = self._now()
        company = CompanyRecord(
            id=self._new_id("company"),
            name=setup.company.name,
            domain=setup.company.domain,
            status="active",
            createdAt=now,
        )
        department = DepartmentRecord(
            id=self._new_id("dept"),
            companyId=company.id,
            name="본사",
            parentId=None,
            status="active",
            sortOrder=100,
            createdAt=now,
        )
        admin_role = RoleRecord(
            id=self._new_id("role"),
            companyId=company.id,
            name="관리자",
            permissions=[
                "admin:*",
                "approval:read",
                "approval:create",
                "approval:submit",
                "approval:act",
                "approval:withdraw",
                "approval:rework",
                "approval:force",
                "directory:write",
                "relay:test",
                "domain:verify",
            ],
            status="active",
            createdAt=now,
        )
        user_role = RoleRecord(
            id=self._new_id("role"),
            companyId=company.id,
            name="일반사용자",
            permissions=[
                "mail:read",
                "approval:read",
                "approval:create",
                "approval:submit",
                "approval:act",
                "approval:withdraw",
                "approval:rework",
                "profile:read",
            ],
            status="active",
            createdAt=now,
        )
        provider = MailProviderConfigRecord(
            id=self._new_id("provider"),
            companyId=company.id,
            providerType=setup.mail_provider.provider_type,
            relayHost=setup.mail_provider.relay_host,
            relayPort=setup.mail_provider.relay_port,
            username=setup.mail_provider.username,
            encryptedPassword=setup.mail_provider.encrypted_password,
            active=True,
            lastTestStatus="not_tested",
            lastTestMessage="단계 2 Relay 테스트 전",
            updatedAt=now,
        )
        admin_user = UserRecord(
            id=self._new_id("user"),
            companyId=company.id,
            email=setup.admin_user.email.lower(),
            name=setup.admin_user.name,
            passwordHash=setup.admin_user.password_hash,
            departmentId=department.id,
            roleId=admin_role.id,
            status="active",
            userType="admin",
            createdAt=now,
            updatedAt=now,
        )
        admin_account = MailAccountRecord(
            id=self._new_id("mail"),
            userId=admin_user.id,
            email=admin_user.email,
            quotaMb=4096,
            status="active",
            providerConfigId=provider.id,
            createdAt=now,
            updatedAt=now,
        )
        state = DirectoryState(
            companies=[company],
            departments=[department],
            roles=[admin_role, user_role],
            users=[admin_user],
            mailAccounts=[admin_account],
            mailProviderConfigs=[provider],
            approvalDocuments=[],
            approvalLines=[],
            auditLogs=[],
        )
        self.save(state)
        return state

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _now(self) -> datetime:
        return datetime.now(UTC)

    @contextlib.contextmanager
    def _process_state_lock(self):
        lock_path = self.state_file.with_suffix(".lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(lock_path, "a+") as lock_file:
            if os.name == "nt":
                import msvcrt

                lock_file.seek(0)
                try:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                    yield
                finally:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
