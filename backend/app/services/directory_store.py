from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import json
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.schemas.directory import (
    ApprovalActionReason,
    ApprovalAttachmentView,
    ApprovalAttachmentMeta,
    ApprovalAttachmentUploadResponse,
    ApprovalApproverListResponse,
    ApprovalApproverView,
    ApprovalBasicPreferenceResponse,
    ApprovalDelegationCreateRequest,
    ApprovalDelegationListResponse,
    ApprovalDelegationUpdateRequest,
    ApprovalDelegationView,
    ApprovalCreateResponse,
    ApprovalDocumentCreateRequest,
    ApprovalDocumentDetailResponse,
    ApprovalDocumentResponse,
    ApprovalDocumentUpdateRequest,
    ApprovalLineRecord,
    ApprovalLineActionRequest,
    ApprovalListResponse,
    AuditLogListResponse,
    AuditLogRecord,
    AuditLogView,
    AuthUserSummary,
    CompanyRecord,
    DepartmentRecord,
    DirectoryOverviewResponse,
    MailAccountRecord,
    MailProviderConfigRecord,
    MailProviderConfigView,
    RoleRecord,
    RoleUpdateRequest,
    UserCreateRequest,
    UserStatusIssue,
    UserUpdateRequest,
    UserView,
)
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.services.observability_service import ObservabilityService
from app.schemas.setup import SetupInitializeRequest
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService
from app.services.approval_attachment_storage import (
    APPROVAL_ATTACHMENT_MAX_COUNT,
    APPROVAL_ATTACHMENT_MAX_TOTAL_BYTES,
    ApprovalAttachmentStorage,
)
from app.services.approval_signature_storage import ApprovalSignatureStorage, detect_safe_image_type


class ApprovalPreferenceConflictError(Exception):
    pass


class ApprovalDelegationConflictError(Exception):
    pass


class ApprovalDelegationOverlapError(Exception):
    pass


class ApprovalDelegateInvalidError(Exception):
    pass


class ApprovalDelegationPeriodError(Exception):
    pass


class ApprovalDelegationNotFoundError(Exception):
    pass


class DirectoryStore:
    def __init__(self) -> None:
        self.db = PostgresService()
        self.security = SecurityService()

    def is_initialized(self) -> bool:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) AS count FROM companies")
                company_count = int(cursor.fetchone()["count"])
                cursor.execute("SELECT COUNT(*) AS count FROM users WHERE user_type = 'admin'")
                admin_count = int(cursor.fetchone()["count"])
        return company_count > 0 and admin_count > 0

    def initialize_installation(self, payload: SetupInitializeRequest) -> None:
        self.db.ensure_migrations_applied(payload.dbConfig)
        with self.db.connect(payload.dbConfig) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) AS count FROM companies")
                if int(cursor.fetchone()["count"]) > 0:
                    raise ValueError("이미 초기 설정이 완료된 시스템입니다.")

                now = self._now()
                company_id = self._new_id("company")
                department_id = self._new_id("dept")
                admin_role_id = self._new_id("role")
                user_role_id = self._new_id("role")
                provider_id = self._new_id("provider")
                admin_user_id = self._new_id("user")
                admin_mail_account_id = self._new_id("mail")

                cursor.execute(
                    """
                    INSERT INTO companies (id, name, domain, status, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (company_id, payload.company.name, payload.company.domain, "active", now),
                )
                cursor.execute(
                    """
                    INSERT INTO departments (id, company_id, name, parent_id, status, sort_order, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (department_id, company_id, "본사", None, "active", 100, now),
                )
                cursor.execute(
                    """
                    INSERT INTO roles (id, company_id, name, permissions, status, created_at)
                    VALUES (%s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        admin_role_id,
                        company_id,
                        "관리자",
                        json.dumps(
                            [
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
                            ]
                        ),
                        "active",
                        now,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO roles (id, company_id, name, permissions, status, created_at)
                    VALUES (%s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        user_role_id,
                        company_id,
                        "일반사용자",
                        json.dumps(
                            [
                                "mail:read",
                                "mail:send",
                                "messenger:read",
                                "messenger:write",
                                "approval:read",
                                "approval:create",
                                "approval:submit",
                                "approval:act",
                                "approval:withdraw",
                                "approval:rework",
                                "profile:read",
                            ]
                        ),
                        "active",
                        now,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO mail_provider_configs (
                        id, company_id, provider_type, relay_host, relay_port, username,
                        encrypted_password, active, last_test_status, last_test_message, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        provider_id,
                        company_id,
                        payload.mailProvider.provider_type,
                        payload.mailProvider.relay_host,
                        payload.mailProvider.relay_port,
                        payload.mailProvider.username,
                        self.security.encrypt_secret(payload.mailProvider.password),
                        True,
                        "not_tested",
                        "단계 2 Relay 테스트 전",
                        now,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO users (
                        id, company_id, email, name, password_hash, department_id, role_id,
                        status, user_type, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        admin_user_id,
                        company_id,
                        payload.adminUser.email,
                        payload.adminUser.name,
                        self.security.hash_password(payload.adminUser.password),
                        department_id,
                        admin_role_id,
                        "active",
                        "admin",
                        now,
                        now,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO mail_accounts (
                        id, user_id, email, quota_mb, status, provider_config_id, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        admin_mail_account_id,
                        admin_user_id,
                        payload.adminUser.email,
                        4096,
                        "active",
                        provider_id,
                        now,
                        now,
                    ),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=company_id,
                    actor_user_id=admin_user_id,
                    actor_user_name=payload.adminUser.name,
                    target_type="system",
                    target_id=company_id,
                    event="setup.initialized",
                    status_before=None,
                    status_after="initialized",
                    reason="단계 2 PostgreSQL 초기 설치 완료",
                )
            connection.commit()

    def verify_initialization(self, payload: SetupInitializeRequest) -> dict[str, object]:
        self.db.ensure_migrations_applied(payload.dbConfig)
        expected_domain = payload.company.domain.strip().lower()
        expected_admin_email = payload.adminUser.email.strip().lower()

        with self.db.connect(payload.dbConfig) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) AS count FROM companies")
                company_count = int(cursor.fetchone()["count"])
                cursor.execute("SELECT COUNT(*) AS count FROM users WHERE user_type = 'admin'")
                admin_count = int(cursor.fetchone()["count"])
                cursor.execute(
                    """
                    SELECT id, name, domain
                    FROM companies
                    WHERE LOWER(domain) = %s
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (expected_domain,),
                )
                company_row = cursor.fetchone()
                cursor.execute(
                    """
                    SELECT id, email, user_type
                    FROM users
                    WHERE user_type = 'admin' AND LOWER(email) = %s
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (expected_admin_email,),
                )
                admin_row = cursor.fetchone()

        return {
            "company_count": company_count,
            "admin_count": admin_count,
            "domain_matched": company_row is not None,
            "admin_email_matched": admin_row is not None,
            "expected_domain": expected_domain,
            "expected_admin_email": expected_admin_email,
        }

    def get_overview(self) -> DirectoryOverviewResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                company_row = self._fetch_company_row(cursor)
                provider_row = self._fetch_provider_row(cursor)
                cursor.execute(
                    """
                    SELECT id, company_id, name, parent_id, status, sort_order, created_at
                    FROM departments
                    ORDER BY sort_order ASC, created_at ASC
                    """
                )
                departments = [self._to_department_record(row) for row in cursor.fetchall()]
                cursor.execute(
                    """
                    SELECT id, company_id, name, permissions, status, created_at
                    FROM roles
                    ORDER BY created_at ASC
                    """
                )
                roles = [self._to_role_record(row) for row in cursor.fetchall()]
                cursor.execute(
                    """
                    SELECT
                        u.id AS user_id,
                        u.company_id,
                        u.name AS user_name,
                        u.email AS user_email,
                        u.status AS user_status,
                        u.user_type,
                        d.id AS department_id,
                        d.name AS department_name,
                        r.id AS role_id,
                        r.name AS role_name,
                        r.permissions,
                        r.status AS role_status,
                        ma.email AS mail_account_email,
                        ma.status AS mail_account_status
                    FROM users u
                    JOIN departments d ON d.id = u.department_id
                    JOIN roles r ON r.id = u.role_id
                    JOIN mail_accounts ma ON ma.user_id = u.id
                    ORDER BY u.created_at ASC
                    """
                )
                user_rows = cursor.fetchall()

        users = [self._row_to_user_view(row) for row in user_rows]
        return DirectoryOverviewResponse(
            company=self._to_company_record(company_row),
            departments=departments,
            roles=roles,
            users=users,
            mailProvider=self._to_mail_provider_view(provider_row),
        )

    def authenticate(self, email: str, password: str) -> AuthUserSummary:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                row = self._fetch_user_access_row(cursor, "u.email = %s", (email.strip().lower(),))

        if row is None:
            if not self.is_initialized():
                raise ValueError("초기 설정이 완료되지 않았습니다.")
            raise ValueError("로그인 정보가 올바르지 않습니다.")
        if not self.security.verify_password(password, row["password_hash"]):
            raise ValueError("로그인 정보가 올바르지 않습니다.")

        self._assert_user_accessible(row)
        return self._row_to_auth_summary(row)

    def get_user_summary(self, user_id: str) -> AuthUserSummary:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                row = self._fetch_user_access_row(cursor, "u.id = %s", (user_id,))

        if row is None:
            raise ValueError("대상 사용자를 찾을 수 없습니다.")
        self._assert_user_accessible(row)
        return self._row_to_auth_summary(row)

    def create_department(self, name: str, parent_id: str | None, sort_order: int) -> DepartmentRecord:
        self.db.ensure_migrations_applied()
        company = self._require_company()
        department_id = self._new_id("dept")
        now = self._now()

        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                if parent_id is not None:
                    cursor.execute("SELECT 1 FROM departments WHERE id = %s", (parent_id,))
                    if cursor.fetchone() is None:
                        raise ValueError("대상 부서를 찾을 수 없습니다.")
                cursor.execute(
                    """
                    INSERT INTO departments (id, company_id, name, parent_id, status, sort_order, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, company_id, name, parent_id, status, sort_order, created_at
                    """,
                    (department_id, company.id, name.strip(), parent_id, "active", sort_order, now),
                )
                row = cursor.fetchone()
            connection.commit()
        return self._to_department_record(row)

    def create_role(self, name: str, permissions: list[str]) -> RoleRecord:
        self.db.ensure_migrations_applied()
        company = self._require_company()
        role_id = self._new_id("role")
        now = self._now()
        role_permissions = permissions or ["mail:read", "mail:send", "messenger:read", "messenger:write", "approval:read", "approval:create"]

        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO roles (id, company_id, name, permissions, status, created_at)
                    VALUES (%s, %s, %s, %s::jsonb, %s, %s)
                    RETURNING id, company_id, name, permissions, status, created_at
                    """,
                    (role_id, company.id, name.strip(), json.dumps(role_permissions), "active", now),
                )
                row = cursor.fetchone()
            connection.commit()
        return self._to_role_record(row)

    def update_role(self, role_id: str, payload: RoleUpdateRequest) -> RoleRecord:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                current = self._fetch_required_role(cursor, role_id)
                next_name = payload.name.strip() if payload.name is not None else current["name"]
                next_permissions = payload.permissions if payload.permissions is not None else self._permissions(current["permissions"])
                next_status = payload.status or current["status"]

                cursor.execute(
                    """
                    UPDATE roles
                    SET name = %s,
                        permissions = %s::jsonb,
                        status = %s
                    WHERE id = %s
                    RETURNING id, company_id, name, permissions, status, created_at
                    """,
                    (next_name, json.dumps(next_permissions), next_status, role_id),
                )
                row = cursor.fetchone()
                if row is None:
                    raise ValueError("대상 권한을 찾을 수 없습니다.")
                self._insert_audit(
                    cursor=cursor,
                    company_id=current["company_id"],
                    actor_user_id=None,
                    actor_user_name="system",
                    target_type="role",
                    target_id=role_id,
                    event="directory.role_updated",
                    status_before=current["status"],
                    status_after=next_status,
                    reason=None,
                )
            connection.commit()
        return self._to_role_record(row)

    def create_user(self, payload: UserCreateRequest) -> UserView:
        self.db.ensure_migrations_applied()
        company = self._require_company()
        normalized_email = payload.email.lower()
        now = self._now()
        user_id = self._new_id("user")
        mail_account_id = self._new_id("mail")

        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                department = self._fetch_required_department(cursor, payload.departmentId)
                role = self._fetch_required_role(cursor, payload.roleId)
                provider = self._fetch_provider_row(cursor)
                cursor.execute("SELECT 1 FROM users WHERE email = %s", (normalized_email,))
                if cursor.fetchone() is not None:
                    raise ValueError("이미 존재하는 이메일입니다.")

                cursor.execute(
                    """
                    INSERT INTO users (
                        id, company_id, email, name, password_hash, department_id, role_id,
                        status, user_type, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        company.id,
                        normalized_email,
                        payload.name.strip(),
                        self.security.hash_password(payload.password),
                        department["id"],
                        role["id"],
                        payload.status,
                        payload.userType,
                        now,
                        now,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO mail_accounts (
                        id, user_id, email, quota_mb, status, provider_config_id, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        mail_account_id,
                        user_id,
                        normalized_email,
                        2048,
                        "active" if payload.status == "active" else "inactive",
                        provider["id"],
                        now,
                        now,
                    ),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=company.id,
                    actor_user_id=user_id,
                    actor_user_name=payload.name.strip(),
                    target_type="user",
                    target_id=user_id,
                    event="directory.user_created",
                    status_before=None,
                    status_after=payload.status,
                    reason=None,
                )
                row = self._fetch_user_view_row(cursor, user_id)
            connection.commit()
        return self._row_to_user_view(row)

    def update_user(self, user_id: str, payload: UserUpdateRequest) -> UserView:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                current = self._fetch_user_access_row(cursor, "u.id = %s", (user_id,))
                if current is None:
                    raise ValueError("대상 사용자를 찾을 수 없습니다.")

                next_name = payload.name.strip() if payload.name is not None else current["user_name"]
                next_department_id = payload.departmentId or current["department_id"]
                next_role_id = payload.roleId or current["role_id"]
                next_status = payload.status or current["user_status"]
                next_password_hash = (
                    self.security.hash_password(payload.password)
                    if payload.password is not None
                    else current["password_hash"]
                )

                self._fetch_required_department(cursor, next_department_id)
                self._fetch_required_role(cursor, next_role_id)

                cursor.execute(
                    """
                    UPDATE users
                    SET name = %s,
                        password_hash = %s,
                        department_id = %s,
                        role_id = %s,
                        status = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (next_name, next_password_hash, next_department_id, next_role_id, next_status, self._now(), user_id),
                )
                cursor.execute(
                    """
                    UPDATE mail_accounts
                    SET status = %s,
                        updated_at = %s
                    WHERE user_id = %s
                    """,
                    ("active" if next_status == "active" else "inactive", self._now(), user_id),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=current["company_id"],
                    actor_user_id=user_id,
                    actor_user_name=next_name,
                    target_type="user",
                    target_id=user_id,
                    event="directory.user_updated",
                    status_before=current["user_status"],
                    status_after=next_status,
                    reason=None,
                )
                row = self._fetch_user_view_row(cursor, user_id)
            connection.commit()
        return self._row_to_user_view(row)

    def get_provider(self, provider_config_id: str | None = None) -> MailProviderConfigRecord:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                if provider_config_id is None:
                    row = self._fetch_provider_row(cursor)
                else:
                    cursor.execute(
                        """
                        SELECT id, company_id, provider_type, relay_host, relay_port, username,
                               encrypted_password, active, last_test_status, last_test_message, updated_at
                        FROM mail_provider_configs
                        WHERE id = %s
                        """,
                        (provider_config_id,),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        raise ValueError("대상 Relay 설정을 찾을 수 없습니다.")
        return self._to_mail_provider_record(row)

    def update_relay_test_status(self, provider_config_id: str, status_value: str, message: str) -> MailProviderConfigRecord:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE mail_provider_configs
                    SET last_test_status = %s,
                        last_test_message = %s,
                        updated_at = %s
                    WHERE id = %s
                    RETURNING id, company_id, provider_type, relay_host, relay_port, username,
                              encrypted_password, active, last_test_status, last_test_message, updated_at
                    """,
                    (status_value, message, self._now(), provider_config_id),
                )
                row = cursor.fetchone()
                if row is None:
                    raise ValueError("대상 Relay 설정을 찾을 수 없습니다.")
            connection.commit()
        return self._to_mail_provider_record(row)

    def list_active_approval_approvers(self, actor_id: str) -> ApprovalApproverListResponse:
        actor = self.get_user_summary(actor_id)
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        u.id AS user_id,
                        u.name AS user_name,
                        u.email AS user_email,
                        COALESCE(d.name, '미지정') AS department_name
                    FROM users u
                    JOIN roles r ON r.id = u.role_id AND r.company_id = u.company_id
                    LEFT JOIN departments d ON d.id = u.department_id AND d.company_id = u.company_id
                    WHERE u.company_id = %s
                      AND u.status = 'active'
                      AND r.status = 'active'
                      AND (u.department_id IS NULL OR d.status = 'active')
                    ORDER BY department_name ASC, u.name ASC, u.email ASC
                    """,
                    (actor.companyId,),
                )
                rows = cursor.fetchall()
        return ApprovalApproverListResponse(
            users=[
                ApprovalApproverView(
                    userId=row["user_id"],
                    userName=row["user_name"],
                    userEmail=row["user_email"],
                    departmentName=row["department_name"],
                )
                for row in rows
            ]
        )

    def list_approval_documents(self, actor_id: str) -> ApprovalListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                rows = self._fetch_visible_approval_rows(cursor, actor)
                actionable_ids = self._fetch_actor_actionable_document_ids(
                    cursor, actor, [row["id"] for row in rows],
                )
                documents = [
                    self._to_approval_document_response(
                        cursor, row, actor, can_current_user_act=row["id"] in actionable_ids,
                    )
                    for row in rows
                ]
        return ApprovalListResponse(documents=documents)

    def get_audit_logs(self, actor_id: str, target_id: str | None = None) -> AuditLogListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                if target_id:
                    document = self._fetch_required_approval_document(cursor, target_id)
                    self._assert_approval_visible(cursor, actor, document)
                    cursor.execute(
                        """
                        SELECT id, event, actor_user_id, actor_user_name, target_type, target_id,
                               status_before, status_after, reason, created_at
                        FROM audit_logs
                        WHERE company_id = %s AND target_type = 'approval_document' AND target_id = %s
                        ORDER BY created_at DESC
                        """,
                        (actor.companyId, target_id),
                    )
                else:
                    if self._can_view_all_approvals(actor):
                        cursor.execute(
                            """
                            SELECT id, event, actor_user_id, actor_user_name, target_type, target_id,
                                   status_before, status_after, reason, created_at
                            FROM audit_logs
                            WHERE company_id = %s AND target_type = 'approval_document'
                            ORDER BY created_at DESC
                            """,
                            (actor.companyId,),
                        )
                    else:
                        cursor.execute(
                            """
                            SELECT DISTINCT al.id, al.event, al.actor_user_id, al.actor_user_name, al.target_type, al.target_id,
                                            al.status_before, al.status_after, al.reason, al.created_at
                            FROM audit_logs al
                            JOIN approval_documents ad ON ad.id = al.target_id
                            LEFT JOIN approval_lines apl ON apl.document_id = ad.id
                            WHERE al.company_id = %s
                              AND al.target_type = 'approval_document'
                              AND (
                                  ad.creator_user_id = %s
                                  OR apl.approver_user_id = %s
                                  OR apl.decided_by_user_id = %s
                                  OR EXISTS (
                                      SELECT 1
                                      FROM approval_lines current_line
                                      JOIN approval_delegations adg
                                        ON adg.company_id = ad.company_id
                                       AND adg.owner_user_id = current_line.approver_user_id
                                       AND adg.delegate_user_id = %s
                                       AND adg.enabled = TRUE AND adg.deleted_at IS NULL
                                       AND adg.start_date <= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                                       AND adg.end_date >= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                                      WHERE current_line.document_id = ad.id
                                        AND current_line.sequence = ad.current_line_index
                                        AND current_line.status = 'pending'
                                  )
                              )
                            ORDER BY al.created_at DESC
                            """,
                            (actor.companyId, actor.userId, actor.userId, actor.userId, actor.userId),
                        )
                rows = cursor.fetchall()
        return AuditLogListResponse(logs=[self._to_audit_view(row) for row in rows])

    def get_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentDetailResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                row = self._fetch_required_approval_document(cursor, document_id)
                self._assert_approval_visible(cursor, actor, row)
                return self._to_approval_document_detail_response(cursor, row, actor)

    def get_approval_attachment(self, actor_id: str, document_id: str, attachment_id: str) -> dict[str, object]:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id)
                self._assert_approval_visible(cursor, actor, document)
                cursor.execute(
                    """
                    SELECT id, file_name, content_type, size_bytes, storage_key, created_at
                    FROM approval_attachments
                    WHERE document_id = %s AND id = %s
                    """,
                    (document_id, attachment_id),
                )
                row = cursor.fetchone()
        if row is None:
            raise ValueError("대상 결재 첨부를 찾을 수 없습니다.")
        return {
            "path": ApprovalAttachmentStorage().stored_path(row["storage_key"]),
            "fileName": row["file_name"],
            "contentType": row["content_type"],
        }

    def get_approval_basic_preferences(self, actor_id: str) -> ApprovalBasicPreferenceResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                cursor.execute(
                    """
                    SELECT writing_method, attachment_image_display, signature_file_name,
                           signature_content_type, signature_size_bytes, version
                    FROM approval_basic_preferences
                    WHERE user_id = %s AND company_id = %s
                    """,
                    (actor.userId, actor.companyId),
                )
                row = cursor.fetchone()
        if row is None:
            return ApprovalBasicPreferenceResponse(
                writingMethod="general",
                attachmentImageDisplay="thumbnail",
                version=0,
                hasSignature=False,
            )
        has_signature = bool(row["signature_file_name"])
        return ApprovalBasicPreferenceResponse(
            writingMethod=row["writing_method"],
            attachmentImageDisplay=row["attachment_image_display"],
            version=row["version"],
            hasSignature=has_signature,
            signatureFileName=row["signature_file_name"],
            signatureContentType=row["signature_content_type"],
            signatureSizeBytes=row["signature_size_bytes"],
            signatureUrl="/api/v1/approvals/settings/signature" if has_signature else None,
        )

    def get_approval_signature(self, actor_id: str) -> dict[str, object]:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                cursor.execute(
                    """
                    SELECT signature_storage_key, signature_file_name, signature_content_type
                    FROM approval_basic_preferences
                    WHERE user_id = %s AND company_id = %s
                    """,
                    (actor.userId, actor.companyId),
                )
                row = cursor.fetchone()
        if row is None or not row["signature_storage_key"]:
            raise ValueError("등록된 서명 파일이 없습니다.")
        return {
            "path": ApprovalSignatureStorage().stored_path(row["signature_storage_key"]),
            "fileName": row["signature_file_name"],
            "contentType": row["signature_content_type"],
        }

    def update_approval_basic_preferences(
        self,
        actor_id: str,
        writing_method: str,
        attachment_image_display: str,
        expected_version: int,
        remove_signature: bool,
        signature: tuple[str, str, bytes] | None,
    ) -> ApprovalBasicPreferenceResponse:
        if writing_method != "general":
            raise ValueError("지원하지 않는 결재 작성 방식입니다.")
        if attachment_image_display not in {"thumbnail", "original", "filename"}:
            raise ValueError("지원하지 않는 첨부 이미지 표시 방식입니다.")
        if expected_version < 0:
            raise ValueError("설정 버전이 올바르지 않습니다.")
        if remove_signature and signature is not None:
            raise ValueError("서명 등록과 제거를 동시에 요청할 수 없습니다.")

        self.db.ensure_migrations_applied()
        storage = ApprovalSignatureStorage()
        staged = storage.stage(*signature) if signature is not None else None
        old_storage_key: str | None = None
        old_referenced = False
        try:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    actor = self._fetch_actor_summary(cursor, actor_id)
                    cursor.execute(
                        """
                        SELECT writing_method, attachment_image_display, signature_storage_key,
                               signature_file_name, signature_content_type, signature_size_bytes, version
                        FROM approval_basic_preferences
                        WHERE user_id = %s AND company_id = %s
                        FOR UPDATE
                        """,
                        (actor.userId, actor.companyId),
                    )
                    current = cursor.fetchone()
                    current_version = int(current["version"]) if current else 0
                    if current_version != expected_version:
                        raise ApprovalPreferenceConflictError("다른 화면에서 설정이 변경되었습니다.")

                    old_storage_key = current["signature_storage_key"] if current else None
                    if staged is not None:
                        signature_values = (
                            staged["storage_key"], staged["file_name"], staged["content_type"], staged["size_bytes"]
                        )
                        signature_action = "added" if not old_storage_key else "replaced"
                    elif remove_signature:
                        signature_values = (None, None, None, None)
                        signature_action = "removed" if old_storage_key else "unchanged"
                    else:
                        signature_values = (
                            current["signature_storage_key"] if current else None,
                            current["signature_file_name"] if current else None,
                            current["signature_content_type"] if current else None,
                            current["signature_size_bytes"] if current else None,
                        )
                        signature_action = "unchanged"

                    next_version = current_version + 1
                    now = self._now()
                    cursor.execute(
                        """
                        INSERT INTO approval_basic_preferences (
                            user_id, company_id, writing_method, attachment_image_display,
                            signature_storage_key, signature_file_name, signature_content_type,
                            signature_size_bytes, version, updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (user_id) DO UPDATE SET
                            company_id = EXCLUDED.company_id,
                            writing_method = EXCLUDED.writing_method,
                            attachment_image_display = EXCLUDED.attachment_image_display,
                            signature_storage_key = EXCLUDED.signature_storage_key,
                            signature_file_name = EXCLUDED.signature_file_name,
                            signature_content_type = EXCLUDED.signature_content_type,
                            signature_size_bytes = EXCLUDED.signature_size_bytes,
                            version = EXCLUDED.version,
                            updated_at = EXCLUDED.updated_at
                        """,
                        (
                            actor.userId, actor.companyId, writing_method, attachment_image_display,
                            *signature_values, next_version, now,
                        ),
                    )
                    changed_policies = []
                    if current is None or current["writing_method"] != writing_method:
                        changed_policies.append("writingMethod")
                    if current is None or current["attachment_image_display"] != attachment_image_display:
                        changed_policies.append("attachmentImageDisplay")
                    self._insert_audit(
                        cursor=cursor,
                        company_id=actor.companyId,
                        actor_user_id=actor.userId,
                        actor_user_name=actor.userName,
                        target_type="approval_preference",
                        target_id=actor.userId,
                        event="approval.settings.updated",
                        status_before=str(current_version),
                        status_after=str(next_version),
                        reason=f"policies={','.join(changed_policies) or 'unchanged'};signature={signature_action}",
                    )
                    if old_storage_key and old_storage_key != signature_values[0]:
                        cursor.execute(
                            "SELECT 1 FROM approval_lines WHERE signature_storage_key = %s LIMIT 1",
                            (old_storage_key,),
                        )
                        old_referenced = cursor.fetchone() is not None
                connection.commit()
        except Exception:
            if staged is not None:
                storage.delete(str(staged["storage_key"]))
            raise

        if old_storage_key and old_storage_key != signature_values[0] and not old_referenced:
            try:
                storage.delete(old_storage_key)
            except (OSError, ValueError):
                pass
        return ApprovalBasicPreferenceResponse(
            writingMethod="general",
            attachmentImageDisplay=attachment_image_display,
            version=next_version,
            hasSignature=bool(signature_values[0]),
            signatureFileName=signature_values[1],
            signatureContentType=signature_values[2],
            signatureSizeBytes=signature_values[3],
            signatureUrl="/api/v1/approvals/settings/signature" if signature_values[0] else None,
        )

    @staticmethod
    def _delegation_status(enabled: bool, start_date: date, end_date: date, today: date) -> str:
        if not enabled:
            return "disabled"
        if today < start_date:
            return "scheduled"
        if today > end_date:
            return "expired"
        return "active"

    @staticmethod
    def _seoul_today() -> date:
        return datetime.now(ZoneInfo("Asia/Seoul")).date()

    def _to_approval_delegation_view(self, row: dict, today: date) -> ApprovalDelegationView:
        return ApprovalDelegationView(
            delegationId=row["id"],
            ownerUserId=row["owner_user_id"],
            delegateUserId=row["delegate_user_id"],
            delegateUserName=row["delegate_user_name"],
            delegateUserEmail=row["delegate_user_email"],
            departmentName=row["department_name"],
            startDate=row["start_date"],
            endDate=row["end_date"],
            reason=row["reason"],
            enabled=row["enabled"],
            status=self._delegation_status(row["enabled"], row["start_date"], row["end_date"], today),
            version=row["version"],
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
        )

    @staticmethod
    def _lock_delegation_owner(cursor, actor: AuthUserSummary) -> None:
        cursor.execute(
            "SELECT id FROM users WHERE id = %s AND company_id = %s FOR UPDATE",
            (actor.userId, actor.companyId),
        )
        if cursor.fetchone() is None:
            raise PermissionError("부재/위임 설정에 접근할 수 없습니다.")

    @staticmethod
    def _validate_delegation_period(start_date: date, end_date: date) -> None:
        if start_date > end_date:
            raise ApprovalDelegationPeriodError("종료일은 시작일보다 빠를 수 없습니다.")

    @staticmethod
    def _validate_delegate(cursor, actor: AuthUserSummary, delegate_user_id: str) -> None:
        if delegate_user_id == actor.userId:
            raise ApprovalDelegateInvalidError("본인을 대결자로 지정할 수 없습니다.")
        cursor.execute(
            """
            SELECT u.id
            FROM users u
            JOIN roles r ON r.id = u.role_id AND r.company_id = u.company_id
            LEFT JOIN departments d ON d.id = u.department_id AND d.company_id = u.company_id
            WHERE u.id = %s AND u.company_id = %s
              AND u.status = 'active' AND r.status = 'active'
              AND (u.department_id IS NULL OR d.status = 'active')
            """,
            (delegate_user_id, actor.companyId),
        )
        if cursor.fetchone() is None:
            raise ApprovalDelegateInvalidError("같은 회사의 활성 사용자만 대결자로 지정할 수 있습니다.")

    @staticmethod
    def _assert_no_delegation_overlap(
        cursor,
        actor: AuthUserSummary,
        start_date: date,
        end_date: date,
        *,
        exclude_id: str | None = None,
    ) -> None:
        query = """
            SELECT 1
            FROM approval_delegations
            WHERE company_id = %s AND owner_user_id = %s
              AND enabled = TRUE AND deleted_at IS NULL
              AND NOT (end_date < %s OR start_date > %s)
        """
        params: list[object] = [actor.companyId, actor.userId, start_date, end_date]
        if exclude_id is not None:
            query += " AND id <> %s"
            params.append(exclude_id)
        query += " LIMIT 1"
        cursor.execute(query, tuple(params))
        if cursor.fetchone() is not None:
            raise ApprovalDelegationOverlapError("활성 위임 기간이 기존 설정과 겹칩니다.")

    @staticmethod
    def _fetch_owned_delegation(cursor, actor: AuthUserSummary, delegation_id: str, *, for_update: bool) -> dict:
        query = """
            SELECT ad.*, u.name AS delegate_user_name, u.email AS delegate_user_email,
                   COALESCE(d.name, '미지정') AS department_name
            FROM approval_delegations ad
            JOIN users u ON u.id = ad.delegate_user_id
            LEFT JOIN departments d ON d.id = u.department_id AND d.company_id = u.company_id
            WHERE ad.id = %s AND ad.company_id = %s AND ad.owner_user_id = %s
              AND ad.deleted_at IS NULL
        """
        if for_update:
            query += " FOR UPDATE OF ad"
        cursor.execute(query, (delegation_id, actor.companyId, actor.userId))
        row = cursor.fetchone()
        if row is None:
            raise ApprovalDelegationNotFoundError("대상 부재/위임 설정을 찾을 수 없습니다.")
        return row

    def list_approval_delegations(self, actor_id: str, page: int, page_size: int) -> ApprovalDelegationListResponse:
        if page < 1 or not 1 <= page_size <= 100:
            raise ValueError("페이지 범위가 올바르지 않습니다.")
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                cursor.execute(
                    "SELECT COUNT(*) AS count FROM approval_delegations WHERE company_id = %s AND owner_user_id = %s AND deleted_at IS NULL",
                    (actor.companyId, actor.userId),
                )
                total = int(cursor.fetchone()["count"])
                cursor.execute(
                    """
                    SELECT ad.*, u.name AS delegate_user_name, u.email AS delegate_user_email,
                           COALESCE(d.name, '미지정') AS department_name
                    FROM approval_delegations ad
                    JOIN users u ON u.id = ad.delegate_user_id
                    LEFT JOIN departments d ON d.id = u.department_id AND d.company_id = u.company_id
                    WHERE ad.company_id = %s AND ad.owner_user_id = %s AND ad.deleted_at IS NULL
                    ORDER BY ad.updated_at DESC, ad.created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (actor.companyId, actor.userId, page_size, (page - 1) * page_size),
                )
                rows = list(cursor.fetchall())
        today = self._seoul_today()
        return ApprovalDelegationListResponse(
            items=[self._to_approval_delegation_view(row, today) for row in rows],
            total=total,
            page=page,
            pageSize=page_size,
        )

    def create_approval_delegation(
        self, actor_id: str, payload: ApprovalDelegationCreateRequest
    ) -> ApprovalDelegationView:
        self._validate_delegation_period(payload.startDate, payload.endDate)
        self.db.ensure_migrations_applied()
        now = self._now()
        delegation_id = self._new_id("delegation")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                self._lock_delegation_owner(cursor, actor)
                self._validate_delegate(cursor, actor, payload.delegateUserId)
                if payload.enabled:
                    self._assert_no_delegation_overlap(cursor, actor, payload.startDate, payload.endDate)
                cursor.execute(
                    """
                    INSERT INTO approval_delegations (
                        id, company_id, owner_user_id, delegate_user_id, start_date, end_date,
                        reason, enabled, version, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1, %s, %s)
                    """,
                    (delegation_id, actor.companyId, actor.userId, payload.delegateUserId,
                     payload.startDate, payload.endDate, payload.reason, payload.enabled, now, now),
                )
                self._insert_audit(
                    cursor=cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                    actor_user_name=actor.userName, target_type="approval_delegation", target_id=delegation_id,
                    event="approval.delegation.created", status_before=None, status_after="1", reason=payload.reason,
                )
                row = self._fetch_owned_delegation(cursor, actor, delegation_id, for_update=False)
            connection.commit()
        return self._to_approval_delegation_view(row, self._seoul_today())

    def update_approval_delegation(
        self, actor_id: str, delegation_id: str, payload: ApprovalDelegationUpdateRequest
    ) -> ApprovalDelegationView:
        self._validate_delegation_period(payload.startDate, payload.endDate)
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                self._lock_delegation_owner(cursor, actor)
                current = self._fetch_owned_delegation(cursor, actor, delegation_id, for_update=True)
                if int(current["version"]) != payload.expectedVersion:
                    raise ApprovalDelegationConflictError("다른 화면에서 위임 설정이 변경되었습니다.")
                self._validate_delegate(cursor, actor, payload.delegateUserId)
                if payload.enabled:
                    self._assert_no_delegation_overlap(
                        cursor, actor, payload.startDate, payload.endDate, exclude_id=delegation_id,
                    )
                next_version = payload.expectedVersion + 1
                cursor.execute(
                    """
                    UPDATE approval_delegations
                    SET delegate_user_id = %s, start_date = %s, end_date = %s, reason = %s,
                        enabled = %s, version = %s, updated_at = %s
                    WHERE id = %s AND company_id = %s AND owner_user_id = %s AND deleted_at IS NULL
                    """,
                    (payload.delegateUserId, payload.startDate, payload.endDate, payload.reason,
                     payload.enabled, next_version, now, delegation_id, actor.companyId, actor.userId),
                )
                self._insert_audit(
                    cursor=cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                    actor_user_name=actor.userName, target_type="approval_delegation", target_id=delegation_id,
                    event="approval.delegation.updated", status_before=str(payload.expectedVersion),
                    status_after=str(next_version), reason=payload.reason,
                )
                row = self._fetch_owned_delegation(cursor, actor, delegation_id, for_update=False)
            connection.commit()
        return self._to_approval_delegation_view(row, self._seoul_today())

    def delete_approval_delegation(
        self, actor_id: str, delegation_id: str, expected_version: int
    ) -> ApprovalDelegationView:
        if expected_version < 1:
            raise ApprovalDelegationConflictError("위임 설정 버전이 올바르지 않습니다.")
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                self._lock_delegation_owner(cursor, actor)
                current = self._fetch_owned_delegation(cursor, actor, delegation_id, for_update=True)
                if int(current["version"]) != expected_version:
                    raise ApprovalDelegationConflictError("다른 화면에서 위임 설정이 변경되었습니다.")
                next_version = expected_version + 1
                cursor.execute(
                    """
                    UPDATE approval_delegations
                    SET deleted_at = %s, updated_at = %s, version = %s
                    WHERE id = %s AND company_id = %s AND owner_user_id = %s AND deleted_at IS NULL
                    """,
                    (now, now, next_version, delegation_id, actor.companyId, actor.userId),
                )
                self._insert_audit(
                    cursor=cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                    actor_user_name=actor.userName, target_type="approval_delegation", target_id=delegation_id,
                    event="approval.delegation.deleted", status_before=str(expected_version),
                    status_after=str(next_version), reason=current["reason"],
                )
            connection.commit()
        return self._to_approval_delegation_view({**current, "version": next_version, "updated_at": now}, self._seoul_today())

    def get_approval_line_signature(self, actor_id: str, document_id: str, line_id: str) -> dict[str, object]:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id)
                self._assert_approval_visible(cursor, actor, document)
                cursor.execute(
                    """
                    SELECT signature_storage_key, signature_file_name, signature_content_type
                    FROM approval_lines
                    WHERE document_id = %s AND id = %s
                    """,
                    (document_id, line_id),
                )
                row = cursor.fetchone()
        if row is None or not row["signature_storage_key"]:
            raise ValueError("승인 시점의 서명이 없습니다.")
        return {
            "path": ApprovalSignatureStorage().stored_path(row["signature_storage_key"]),
            "fileName": row["signature_file_name"],
            "contentType": row["signature_content_type"],
        }

    def get_approval_attachment_preview(self, actor_id: str, document_id: str, attachment_id: str) -> dict[str, object]:
        item = self.get_approval_attachment(actor_id, document_id, attachment_id)
        path = item["path"]
        detected_type = detect_safe_image_type(path.read_bytes())
        if detected_type is None:
            raise ValueError("미리보기 가능한 이미지 첨부가 아닙니다.")
        return {**item, "contentType": detected_type}

    def stage_approval_attachment(
        self,
        actor_id: str,
        file_name: str,
        content_type: str,
        content: bytes,
    ) -> ApprovalAttachmentUploadResponse:
        self.db.ensure_migrations_applied()
        storage = ApprovalAttachmentStorage()
        staged = storage.stage(file_name, content_type, content)
        now = self._now()
        try:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    actor = self._fetch_actor_summary(cursor, actor_id)
                    cursor.execute(
                        """
                        INSERT INTO approval_attachment_uploads (
                            id, company_id, owner_user_id, file_name, content_type,
                            size_bytes, storage_key, created_at, expires_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            staged["upload_id"],
                            actor.companyId,
                            actor.userId,
                            staged["file_name"],
                            staged["content_type"],
                            staged["size_bytes"],
                            staged["storage_key"],
                            now,
                            now + timedelta(hours=24),
                        ),
                    )
                connection.commit()
        except Exception:
            storage.delete(str(staged["storage_key"]))
            raise
        return ApprovalAttachmentUploadResponse(
            uploadId=str(staged["upload_id"]),
            fileName=str(staged["file_name"]),
            contentType=str(staged["content_type"]),
            sizeBytes=int(staged["size_bytes"]),
        )

    def _validate_approval_approvers(
        self,
        cursor,
        actor: AuthUserSummary,
        approver_user_ids: list[str],
    ) -> list[dict]:
        if len(approver_user_ids) != len(set(approver_user_ids)):
            raise ValueError("결재선 사용자를 중복 지정할 수 없습니다.")
        if len(approver_user_ids) > 20:
            raise ValueError("결재선은 최대 20명까지 지정할 수 있습니다.")
        if not approver_user_ids:
            return []
        cursor.execute(
            """
            SELECT u.id AS user_id, u.name AS user_name
            FROM users u
            JOIN roles r ON r.id = u.role_id AND r.company_id = u.company_id
            LEFT JOIN departments d ON d.id = u.department_id AND d.company_id = u.company_id
            WHERE u.company_id = %s
              AND u.id = ANY(%s)
              AND u.status = 'active'
              AND r.status = 'active'
              AND (u.department_id IS NULL OR d.status = 'active')
            """,
            (actor.companyId, approver_user_ids),
        )
        rows = cursor.fetchall()
        by_id = {row["user_id"]: row for row in rows}
        if any(user_id not in by_id for user_id in approver_user_ids):
            raise ValueError("같은 회사의 활성 사용자만 결재선에 지정할 수 있습니다.")
        return [by_id[user_id] for user_id in approver_user_ids]

    def _consume_approval_uploads(
        self,
        cursor,
        actor: AuthUserSummary,
        attachments: list[ApprovalAttachmentMeta],
        *,
        document_id: str,
        now: datetime,
        retained_count: int = 0,
        retained_size: int = 0,
    ) -> None:
        if retained_count + len(attachments) > APPROVAL_ATTACHMENT_MAX_COUNT:
            raise ValueError("결재 첨부는 최대 10개까지 등록할 수 있습니다.")
        total_size = retained_size
        resolved: list[dict] = []
        for attachment in attachments:
            cursor.execute(
                """
                SELECT id, file_name, content_type, size_bytes, storage_key
                FROM approval_attachment_uploads
                WHERE id = %s
                  AND owner_user_id = %s
                  AND company_id = %s
                  AND expires_at > %s
                FOR UPDATE
                """,
                (attachment.uploadId, actor.userId, actor.companyId, now),
            )
            row = cursor.fetchone()
            if row is None:
                raise ValueError("사용할 수 없거나 만료된 결재 첨부 업로드입니다.")
            canonical = (row["file_name"], row["content_type"], int(row["size_bytes"]))
            requested = (attachment.fileName, attachment.contentType, attachment.sizeBytes)
            if canonical != requested:
                raise ValueError("결재 첨부 정보가 업로드 결과와 일치하지 않습니다.")
            ApprovalAttachmentStorage().stored_path(row["storage_key"])
            total_size += int(row["size_bytes"])
            resolved.append(row)
        if total_size > APPROVAL_ATTACHMENT_MAX_TOTAL_BYTES:
            raise ValueError("결재 첨부의 전체 크기는 25MB를 초과할 수 없습니다.")
        for row in resolved:
            cursor.execute(
                """
                INSERT INTO approval_attachments (
                    id, document_id, file_name, content_type, size_bytes, storage_key, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    self._new_id("aatt"),
                    document_id,
                    row["file_name"],
                    row["content_type"],
                    row["size_bytes"],
                    row["storage_key"],
                    now,
                ),
            )
            cursor.execute(
                "DELETE FROM approval_attachment_uploads WHERE id = %s",
                (row["id"],),
            )

    def create_approval_document(self, actor_id: str, payload: ApprovalDocumentCreateRequest) -> ApprovalCreateResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        document_id = self._new_id("doc")

        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                approvers = self._validate_approval_approvers(cursor, actor, payload.approverUserIds)
                cursor.execute(
                    """
                    INSERT INTO approval_documents (
                        id, company_id, title, content, creator_user_id, status,
                        current_line_index, submitted_by_user_id, submitted_at, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        document_id,
                        actor.companyId,
                        payload.title.strip(),
                        payload.content.strip(),
                        actor.userId,
                        "draft",
                        None,
                        None,
                        None,
                        now,
                        now,
                    ),
                )
                for sequence, approver in enumerate(approvers, start=1):
                    cursor.execute(
                        """
                        INSERT INTO approval_lines (
                            id, document_id, approver_user_id, approver_user_name,
                            sequence, status, comment, decided_by_user_id, decided_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            self._new_id("aline"),
                            document_id,
                            approver["user_id"],
                            approver["user_name"],
                            sequence,
                            "pending",
                            None,
                            None,
                            None,
                        ),
                    )
                self._consume_approval_uploads(
                    cursor,
                    actor,
                    payload.attachments,
                    document_id=document_id,
                    now=now,
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=actor.companyId,
                    actor_user_id=actor.userId,
                    actor_user_name=actor.userName,
                    target_type="approval_document",
                    target_id=document_id,
                    event="approval.created",
                    status_before=None,
                    status_after="draft",
                    reason=None,
                )
            connection.commit()
        return ApprovalCreateResponse(documentId=document_id)

    def update_approval_document(
        self,
        actor_id: str,
        document_id: str,
        payload: ApprovalDocumentUpdateRequest,
    ) -> ApprovalDocumentDetailResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        removed_storage_keys: list[str] = []
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id, for_update=True)
                self._assert_creator(actor, document)
                self._assert_document_status(document, allowed={"draft"}, action_label="수정")
                approvers = self._validate_approval_approvers(cursor, actor, payload.approverUserIds)
                cursor.execute(
                    """
                    SELECT id, size_bytes, storage_key
                    FROM approval_attachments
                    WHERE document_id = %s
                    FOR UPDATE
                    """,
                    (document_id,),
                )
                existing = cursor.fetchall()
                existing_by_id = {row["id"]: row for row in existing}
                if any(attachment_id not in existing_by_id for attachment_id in payload.retainedAttachmentIds):
                    raise ValueError("유지할 결재 첨부를 찾을 수 없습니다.")
                retained = [existing_by_id[attachment_id] for attachment_id in payload.retainedAttachmentIds]
                if len(retained) + len(payload.attachments) > APPROVAL_ATTACHMENT_MAX_COUNT:
                    raise ValueError("결재 첨부는 최대 10개까지 등록할 수 있습니다.")
                retained_size = sum(int(row["size_bytes"]) for row in retained)

                cursor.execute(
                    """
                    UPDATE approval_documents
                    SET title = %s, content = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (payload.title.strip(), payload.content.strip(), now, document_id),
                )
                cursor.execute("DELETE FROM approval_lines WHERE document_id = %s", (document_id,))
                for sequence, approver in enumerate(approvers, start=1):
                    cursor.execute(
                        """
                        INSERT INTO approval_lines (
                            id, document_id, approver_user_id, approver_user_name,
                            sequence, status, comment, decided_by_user_id, decided_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            self._new_id("aline"),
                            document_id,
                            approver["user_id"],
                            approver["user_name"],
                            sequence,
                            "pending",
                            None,
                            None,
                            None,
                        ),
                    )
                removed_ids = [row["id"] for row in existing if row["id"] not in set(payload.retainedAttachmentIds)]
                if removed_ids:
                    cursor.execute(
                        """
                        DELETE FROM approval_attachments
                        WHERE document_id = %s AND id = ANY(%s)
                        RETURNING storage_key
                        """,
                        (document_id, removed_ids),
                    )
                    removed_storage_keys = [row["storage_key"] for row in cursor.fetchall()]
                self._consume_approval_uploads(
                    cursor,
                    actor,
                    payload.attachments,
                    document_id=document_id,
                    now=now,
                    retained_count=len(retained),
                    retained_size=retained_size,
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=actor.companyId,
                    actor_user_id=actor.userId,
                    actor_user_name=actor.userName,
                    target_type="approval_document",
                    target_id=document_id,
                    event="approval.updated",
                    status_before="draft",
                    status_after="draft",
                    reason=None,
                )
                response = self._to_approval_document_detail_response(
                    cursor,
                    self._fetch_required_approval_document(cursor, document_id),
                    actor,
                )
            connection.commit()
        storage = ApprovalAttachmentStorage()
        for storage_key in removed_storage_keys:
            try:
                storage.delete(storage_key)
            except (OSError, ValueError):
                pass
        return response

    def submit_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id, for_update=True)
                self._assert_creator(actor, document)
                self._assert_document_status(document, allowed={"draft"}, action_label="상신")
                lines = self._fetch_approval_lines(cursor, document_id, for_update=True)
                if not lines:
                    raise ValueError("상신하려면 결재선을 최소 1명 이상 지정해야 합니다.")
                for line in lines:
                    self._fetch_actor_summary(cursor, line["approver_user_id"])

                cursor.execute(
                    """
                    UPDATE approval_documents
                    SET status = 'submitted',
                        current_line_index = %s,
                        submitted_by_user_id = %s,
                        submitted_at = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (lines[0]["sequence"], actor.userId, now, now, document_id),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=actor.companyId,
                    actor_user_id=actor.userId,
                    actor_user_name=actor.userName,
                    target_type="approval_document",
                    target_id=document_id,
                    event="approval.submitted",
                    status_before="draft",
                    status_after="submitted",
                    reason=None,
                )
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id), actor)
            connection.commit()
        self._emit_approval_event(
            actor=actor,
            document=response,
            event_type="approval.submit",
            title="결재 문서가 상신되었습니다.",
            message=f"{actor.userName} 사용자가 '{response.title}' 문서를 상신했습니다.",
            severity=SeverityLevel.INFO,
            status_before="draft",
            status_after="submitted",
            recipients=self._approval_recipients(response, include_creator=True, include_current=True),
        )
        return response

    def approve_approval_document(self, actor_id: str, document_id: str, payload: ApprovalLineActionRequest) -> ApprovalDocumentResponse:
        return self._process_approval_decision(actor_id, document_id, payload.reason, accepted=True, forced=False)

    def reject_approval_document(self, actor_id: str, document_id: str, payload: ApprovalLineActionRequest) -> ApprovalDocumentResponse:
        return self._process_approval_decision(actor_id, document_id, payload.reason, accepted=False, forced=False)

    def withdraw_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id, for_update=True)
                self._assert_creator(actor, document)
                self._assert_document_status(document, allowed={"submitted"}, action_label="회수")
                cursor.execute(
                    """
                    UPDATE approval_documents
                    SET status = 'withdrawn',
                        current_line_index = NULL,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (now, document_id),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=actor.companyId,
                    actor_user_id=actor.userId,
                    actor_user_name=actor.userName,
                    target_type="approval_document",
                    target_id=document_id,
                    event="approval.withdrawn",
                    status_before="submitted",
                    status_after="withdrawn",
                    reason=None,
                )
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id), actor)
            connection.commit()
        self._emit_approval_event(
            actor=actor,
            document=response,
            event_type="approval.withdraw",
            title="결재 문서가 회수되었습니다.",
            message=f"{actor.userName} 사용자가 '{response.title}' 문서를 회수했습니다.",
            severity=SeverityLevel.WARN,
            status_before="submitted",
            status_after="withdrawn",
            recipients=self._approval_recipients(response, include_creator=True),
        )
        return response

    def rework_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id, for_update=True)
                self._assert_creator(actor, document)
                self._assert_document_status(document, allowed={"rejected", "withdrawn"}, action_label="재기안")
                cursor.execute(
                    """
                    UPDATE approval_documents
                    SET status = 'draft',
                        current_line_index = NULL,
                        submitted_by_user_id = NULL,
                        submitted_at = NULL,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (now, document_id),
                )
                cursor.execute(
                    """
                    UPDATE approval_lines
                    SET status = 'pending',
                        comment = NULL,
                        decided_by_user_id = NULL,
                        decided_at = NULL,
                        signature_storage_key = NULL,
                        signature_file_name = NULL,
                        signature_content_type = NULL,
                        signature_size_bytes = NULL,
                        delegation_id = NULL
                    WHERE document_id = %s
                    """,
                    (document_id,),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=actor.companyId,
                    actor_user_id=actor.userId,
                    actor_user_name=actor.userName,
                    target_type="approval_document",
                    target_id=document_id,
                    event="approval.redrafted",
                    status_before=document["status"],
                    status_after="draft",
                    reason=None,
                )
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id), actor)
            connection.commit()
        self._emit_approval_event(
            actor=actor,
            document=response,
            event_type="approval.redraft",
            title="결재 문서가 재기안되었습니다.",
            message=f"{actor.userName} 사용자가 '{response.title}' 문서를 재기안했습니다.",
            severity=SeverityLevel.INFO,
            status_before=document["status"],
            status_after="draft",
            recipients=self._approval_recipients(response, include_creator=True),
        )
        return response

    def admin_force_approve(self, actor_id: str, document_id: str, reason: ApprovalActionReason) -> ApprovalDocumentResponse:
        return self._process_approval_decision(actor_id, document_id, reason.reason, accepted=True, forced=True)

    def admin_force_reject(self, actor_id: str, document_id: str, reason: ApprovalActionReason) -> ApprovalDocumentResponse:
        return self._process_approval_decision(actor_id, document_id, reason.reason, accepted=False, forced=True)

    def _fetch_company_row(self, cursor) -> dict:
        cursor.execute("SELECT id, name, domain, status, created_at FROM companies ORDER BY created_at ASC LIMIT 1")
        row = cursor.fetchone()
        if row is None:
            raise ValueError("초기 설정이 완료되지 않았습니다.")
        return row

    def _fetch_provider_row(self, cursor) -> dict:
        cursor.execute(
            """
            SELECT id, company_id, provider_type, relay_host, relay_port, username,
                   encrypted_password, active, last_test_status, last_test_message, updated_at
            FROM mail_provider_configs
            ORDER BY updated_at DESC
            LIMIT 1
            """
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("메일 설정이 존재하지 않습니다.")
        return row

    def _fetch_required_department(self, cursor, department_id: str) -> dict:
        cursor.execute(
            "SELECT id, company_id, name, parent_id, status, sort_order, created_at FROM departments WHERE id = %s",
            (department_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("대상 부서를 찾을 수 없습니다.")
        return row

    def _fetch_required_role(self, cursor, role_id: str) -> dict:
        cursor.execute(
            "SELECT id, company_id, name, permissions, status, created_at FROM roles WHERE id = %s",
            (role_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("대상 권한을 찾을 수 없습니다.")
        return row

    def _fetch_user_access_row(self, cursor, where_clause: str, params: tuple) -> dict | None:
        cursor.execute(
            f"""
            SELECT
                u.id AS user_id,
                u.company_id,
                u.name AS user_name,
                u.email AS user_email,
                u.password_hash,
                u.department_id,
                u.role_id,
                u.status AS user_status,
                u.user_type,
                d.name AS department_name,
                r.name AS role_name,
                r.permissions,
                r.status AS role_status,
                ma.email AS mail_account_email,
                ma.status AS mail_account_status
            FROM users u
            JOIN departments d ON d.id = u.department_id
            JOIN roles r ON r.id = u.role_id
            JOIN mail_accounts ma ON ma.user_id = u.id
            WHERE {where_clause}
            """,
            params,
        )
        return cursor.fetchone()

    def _fetch_actor_summary(self, cursor, user_id: str) -> AuthUserSummary:
        row = self._fetch_user_access_row(cursor, "u.id = %s", (user_id,))
        if row is None:
            raise ValueError("대상 사용자를 찾을 수 없습니다.")
        self._assert_user_accessible(row)
        return self._row_to_auth_summary(row)

    def _fetch_required_approval_document(self, cursor, document_id: str, *, for_update: bool = False) -> dict:
        query = """
            SELECT
                ad.id,
                ad.company_id,
                ad.title,
                ad.content,
                ad.creator_user_id,
                ad.status,
                ad.current_line_index,
                ad.submitted_by_user_id,
                ad.submitted_at,
                ad.created_at,
                ad.updated_at,
                u.name AS creator_user_name
            FROM approval_documents ad
            JOIN users u ON u.id = ad.creator_user_id
            WHERE ad.id = %s
        """
        if for_update:
            query += " FOR UPDATE"
        cursor.execute(query, (document_id,))
        row = cursor.fetchone()
        if row is None:
            raise ValueError("대상 결재 문서를 찾을 수 없습니다.")
        return row

    def _fetch_approval_lines(self, cursor, document_id: str, *, for_update: bool = False) -> list[dict]:
        query = """
            SELECT
                apl.id,
                apl.document_id,
                apl.approver_user_id,
                apl.approver_user_name,
                apl.sequence,
                apl.status,
                apl.comment,
                apl.decided_by_user_id,
                decided.name AS decided_by_user_name,
                apl.decided_at,
                apl.delegation_id,
                apl.signature_storage_key,
                apl.signature_file_name,
                apl.signature_content_type,
                apl.signature_size_bytes
            FROM approval_lines apl
            LEFT JOIN users decided ON decided.id = apl.decided_by_user_id
            WHERE apl.document_id = %s
            ORDER BY apl.sequence ASC
        """
        if for_update:
            query += " FOR UPDATE OF apl"
        cursor.execute(query, (document_id,))
        return list(cursor.fetchall())

    def _fetch_visible_approval_rows(self, cursor, actor: AuthUserSummary) -> list[dict]:
        if self._can_view_all_approvals(actor):
            cursor.execute(
                """
                SELECT
                    ad.id,
                    ad.company_id,
                    ad.title,
                    ad.content,
                    ad.creator_user_id,
                    ad.status,
                    ad.current_line_index,
                    ad.submitted_by_user_id,
                    ad.submitted_at,
                    ad.created_at,
                    ad.updated_at,
                    u.name AS creator_user_name
                FROM approval_documents ad
                JOIN users u ON u.id = ad.creator_user_id
                WHERE ad.company_id = %s
                ORDER BY ad.updated_at DESC, ad.created_at DESC
                """,
                (actor.companyId,),
            )
        else:
            cursor.execute(
                """
                SELECT DISTINCT
                    ad.id,
                    ad.company_id,
                    ad.title,
                    ad.content,
                    ad.creator_user_id,
                    ad.status,
                    ad.current_line_index,
                    ad.submitted_by_user_id,
                    ad.submitted_at,
                    ad.created_at,
                    ad.updated_at,
                    u.name AS creator_user_name
                FROM approval_documents ad
                JOIN users u ON u.id = ad.creator_user_id
                LEFT JOIN approval_lines apl ON apl.document_id = ad.id
                WHERE ad.company_id = %s
                  AND (
                      ad.creator_user_id = %s
                      OR apl.approver_user_id = %s
                      OR apl.decided_by_user_id = %s
                      OR EXISTS (
                          SELECT 1
                          FROM approval_lines current_line
                          JOIN approval_delegations adg
                            ON adg.company_id = ad.company_id
                           AND adg.owner_user_id = current_line.approver_user_id
                           AND adg.delegate_user_id = %s
                           AND adg.enabled = TRUE
                           AND adg.deleted_at IS NULL
                           AND adg.start_date <= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                           AND adg.end_date >= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                          WHERE current_line.document_id = ad.id
                            AND current_line.sequence = ad.current_line_index
                            AND current_line.status = 'pending'
                      )
                  )
                ORDER BY ad.updated_at DESC, ad.created_at DESC
                """,
                (actor.companyId, actor.userId, actor.userId, actor.userId, actor.userId),
            )
        return list(cursor.fetchall())

    def _assert_approval_visible(self, cursor, actor: AuthUserSummary, document: dict) -> None:
        if document["company_id"] != actor.companyId:
            raise PermissionError("대상 결재 문서에 접근할 수 없습니다.")
        if self._can_view_all_approvals(actor):
            return
        if document["creator_user_id"] == actor.userId:
            return
        cursor.execute(
            """
            SELECT 1
            FROM approval_lines apl
            WHERE apl.document_id = %s
              AND (
                  apl.approver_user_id = %s
                  OR apl.decided_by_user_id = %s
                  OR (
                      apl.sequence = %s AND apl.status = 'pending'
                      AND EXISTS (
                          SELECT 1 FROM approval_delegations adg
                          WHERE adg.company_id = %s
                            AND adg.owner_user_id = apl.approver_user_id
                            AND adg.delegate_user_id = %s
                            AND adg.enabled = TRUE AND adg.deleted_at IS NULL
                            AND adg.start_date <= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                            AND adg.end_date >= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                      )
                  )
              )
            LIMIT 1
            """,
            (document["id"], actor.userId, actor.userId, document["current_line_index"], actor.companyId, actor.userId),
        )
        if cursor.fetchone() is not None:
            return
        raise PermissionError("대상 결재 문서에 접근할 수 없습니다.")

    def _can_actor_process_current_line(self, cursor, row: dict, actor: AuthUserSummary) -> bool:
        if row["status"] != "submitted" or row["current_line_index"] is None:
            return False
        cursor.execute(
            """
            SELECT 1
            FROM approval_lines apl
            WHERE apl.document_id = %s AND apl.sequence = %s AND apl.status = 'pending'
              AND (
                  apl.approver_user_id = %s
                  OR EXISTS (
                      SELECT 1 FROM approval_delegations adg
                      WHERE adg.company_id = %s
                        AND adg.owner_user_id = apl.approver_user_id
                        AND adg.delegate_user_id = %s
                        AND adg.enabled = TRUE AND adg.deleted_at IS NULL
                        AND adg.start_date <= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                        AND adg.end_date >= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                  )
              )
            LIMIT 1
            """,
            (row["id"], row["current_line_index"], actor.userId, actor.companyId, actor.userId),
        )
        return cursor.fetchone() is not None

    def _fetch_actor_actionable_document_ids(
        self, cursor, actor: AuthUserSummary, document_ids: list[str]
    ) -> set[str]:
        if not document_ids:
            return set()
        cursor.execute(
            """
            SELECT DISTINCT apl.document_id
            FROM approval_lines apl
            JOIN approval_documents ad ON ad.id = apl.document_id
            WHERE apl.document_id = ANY(%s)
              AND ad.company_id = %s AND ad.status = 'submitted'
              AND apl.sequence = ad.current_line_index AND apl.status = 'pending'
              AND (
                  apl.approver_user_id = %s
                  OR EXISTS (
                      SELECT 1 FROM approval_delegations adg
                      WHERE adg.company_id = ad.company_id
                        AND adg.owner_user_id = apl.approver_user_id
                        AND adg.delegate_user_id = %s
                        AND adg.enabled = TRUE AND adg.deleted_at IS NULL
                        AND adg.start_date <= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                        AND adg.end_date >= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                  )
              )
            """,
            (document_ids, actor.companyId, actor.userId, actor.userId),
        )
        return {row["document_id"] for row in cursor.fetchall()}

    def _to_approval_document_response(
        self,
        cursor,
        row: dict,
        actor: AuthUserSummary,
        *,
        can_current_user_act: bool | None = None,
    ) -> ApprovalDocumentResponse:
        lines = [
            ApprovalLineRecord(
                id=line["id"],
                documentId=line["document_id"],
                approverUserId=line["approver_user_id"],
                approverUserName=line["approver_user_name"],
                sequence=line["sequence"],
                status=line["status"],
                comment=line["comment"],
                decidedByUserId=line["decided_by_user_id"],
                decidedByUserName=line["decided_by_user_name"],
                decidedAt=line["decided_at"],
                hasSignature=bool(line["signature_storage_key"]),
                signatureUrl=(
                    f"/api/v1/approvals/{row['id']}/lines/{line['id']}/signature"
                    if line["signature_storage_key"] else None
                ),
                delegationId=line["delegation_id"],
            )
            for line in self._fetch_approval_lines(cursor, row["id"])
        ]
        return ApprovalDocumentResponse(
            id=row["id"],
            title=row["title"],
            content=row["content"],
            creatorUserId=row["creator_user_id"],
            creatorUserName=row["creator_user_name"],
            status=row["status"],
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
            submittedByUserId=row["submitted_by_user_id"],
            submittedAt=row["submitted_at"],
            currentLineIndex=row["current_line_index"],
            canCurrentUserAct=(
                self._can_actor_process_current_line(cursor, row, actor)
                if can_current_user_act is None else can_current_user_act
            ),
            lines=lines,
        )

    def _fetch_approval_attachments(self, cursor, document_id: str) -> list[ApprovalAttachmentView]:
        cursor.execute(
            """
            SELECT id, file_name, content_type, size_bytes, created_at
            FROM approval_attachments
            WHERE document_id = %s
            ORDER BY created_at ASC, id ASC
            """,
            (document_id,),
        )
        return [
            ApprovalAttachmentView(
                attachmentId=row["id"],
                fileName=row["file_name"],
                contentType=row["content_type"],
                sizeBytes=row["size_bytes"],
                createdAt=row["created_at"],
                previewUrl=(
                    f"/api/v1/approvals/{document_id}/attachments/{row['id']}/preview"
                    if str(row["content_type"]).lower().startswith("image/") else None
                ),
            )
            for row in cursor.fetchall()
        ]

    def _to_approval_document_detail_response(
        self, cursor, row: dict, actor: AuthUserSummary
    ) -> ApprovalDocumentDetailResponse:
        document = self._to_approval_document_response(cursor, row, actor)
        return ApprovalDocumentDetailResponse(
            **document.model_dump(),
            attachments=self._fetch_approval_attachments(cursor, row["id"]),
        )

    def _assert_creator(self, actor: AuthUserSummary, document: dict) -> None:
        if document["creator_user_id"] != actor.userId:
            raise PermissionError("작성자만 수행할 수 있는 작업입니다.")

    def _assert_document_status(self, document: dict, *, allowed: set[str], action_label: str) -> None:
        current_status = str(document["status"])
        if current_status not in allowed:
            allowed_text = ", ".join(sorted(allowed))
            raise ValueError(f"{action_label}은(는) {allowed_text} 상태에서만 가능합니다.")

    def _can_view_all_approvals(self, actor: AuthUserSummary) -> bool:
        permissions = set(actor.permissions)
        return "admin:*" in permissions or "approval:force" in permissions

    def _process_approval_decision(
        self,
        actor_id: str,
        document_id: str,
        reason: str,
        *,
        accepted: bool,
        forced: bool,
    ) -> ApprovalDocumentResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        normalized_reason = reason.strip()
        if not normalized_reason:
            raise ValueError("사유를 입력해야 합니다.")

        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                document = self._fetch_required_approval_document(cursor, document_id, for_update=True)
                self._assert_document_status(document, allowed={"submitted"}, action_label="결재 처리")
                lines = self._fetch_approval_lines(cursor, document_id, for_update=True)
                if not lines:
                    raise ValueError("결재선이 없는 문서입니다.")

                status_before = document["status"]
                target_line = None
                delegation_id = None
                if forced:
                    pending_lines = [line for line in lines if line["status"] == "pending"]
                    if not pending_lines:
                        raise ValueError("직권 처리할 대기 결재선이 없습니다.")
                    target_line = pending_lines[0]
                else:
                    current_sequence = document["current_line_index"]
                    target_line = next((line for line in lines if line["sequence"] == current_sequence), None)
                    if target_line is None or target_line["status"] != "pending":
                        raise ValueError("현재 처리 가능한 결재선이 없습니다.")
                    if target_line["approver_user_id"] != actor.userId:
                        cursor.execute(
                            """
                            SELECT id
                            FROM approval_delegations
                            WHERE company_id = %s
                              AND owner_user_id = %s
                              AND delegate_user_id = %s
                              AND enabled = TRUE AND deleted_at IS NULL
                              AND start_date <= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                              AND end_date >= timezone('Asia/Seoul', CURRENT_TIMESTAMP)::date
                            ORDER BY updated_at DESC
                            LIMIT 1
                            FOR SHARE
                            """,
                            (actor.companyId, target_line["approver_user_id"], actor.userId),
                        )
                        delegation = cursor.fetchone()
                        if delegation is None:
                            raise PermissionError("현재 결재선의 담당자 또는 유효한 대결자만 처리할 수 있습니다.")
                        delegation_id = delegation["id"]

                if accepted:
                    signature_snapshot = (None, None, None, None)
                    if not forced:
                        cursor.execute(
                            """
                            SELECT signature_storage_key, signature_file_name,
                                   signature_content_type, signature_size_bytes
                            FROM approval_basic_preferences
                            WHERE user_id = %s AND company_id = %s
                            FOR SHARE
                            """,
                            (actor.userId, actor.companyId),
                        )
                        signature_row = cursor.fetchone()
                        if signature_row:
                            signature_snapshot = (
                                signature_row["signature_storage_key"],
                                signature_row["signature_file_name"],
                                signature_row["signature_content_type"],
                                signature_row["signature_size_bytes"],
                            )
                    if forced:
                        cursor.execute(
                            """
                            UPDATE approval_lines
                            SET status = 'approved',
                                comment = COALESCE(comment, %s),
                                decided_by_user_id = COALESCE(decided_by_user_id, %s),
                                decided_at = COALESCE(decided_at, %s)
                            WHERE document_id = %s AND status = 'pending'
                            """,
                            (normalized_reason, actor.userId, now, document_id),
                        )
                        next_status = "approved"
                        next_line_index = None
                        event_name = "approval.force_approved"
                    else:
                        cursor.execute(
                            """
                            UPDATE approval_lines
                            SET status = 'approved',
                                comment = %s,
                                decided_by_user_id = %s,
                                decided_at = %s,
                                signature_storage_key = %s,
                                signature_file_name = %s,
                                signature_content_type = %s,
                                signature_size_bytes = %s,
                                delegation_id = %s
                            WHERE id = %s
                            """,
                            (normalized_reason, actor.userId, now, *signature_snapshot, delegation_id, target_line["id"]),
                        )
                        remaining_pending = [line for line in lines if line["sequence"] > target_line["sequence"] and line["status"] == "pending"]
                        next_status = "approved" if not remaining_pending else "submitted"
                        next_line_index = None if next_status == "approved" else remaining_pending[0]["sequence"]
                        event_name = "approval.approved"
                        if delegation_id:
                            event_name = "approval.delegated_approved"
                else:
                    if forced:
                        cursor.execute(
                            """
                            UPDATE approval_lines
                            SET status = CASE WHEN status = 'approved' THEN status ELSE 'rejected' END,
                                comment = CASE WHEN status = 'approved' THEN comment ELSE %s END,
                                decided_by_user_id = CASE WHEN status = 'approved' THEN decided_by_user_id ELSE %s END,
                                decided_at = CASE WHEN status = 'approved' THEN decided_at ELSE %s END
                            WHERE document_id = %s
                            """,
                            (normalized_reason, actor.userId, now, document_id),
                        )
                        event_name = "approval.force_rejected"
                    else:
                        cursor.execute(
                            """
                            UPDATE approval_lines
                            SET status = 'rejected',
                                comment = %s,
                                decided_by_user_id = %s,
                                decided_at = %s,
                                delegation_id = %s
                            WHERE id = %s
                            """,
                            (normalized_reason, actor.userId, now, delegation_id, target_line["id"]),
                        )
                        event_name = "approval.rejected"
                        if delegation_id:
                            event_name = "approval.delegated_rejected"
                    next_status = "rejected"
                    next_line_index = None

                cursor.execute(
                    """
                    UPDATE approval_documents
                    SET status = %s,
                        current_line_index = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (next_status, next_line_index, now, document_id),
                )
                self._insert_audit(
                    cursor=cursor,
                    company_id=actor.companyId,
                    actor_user_id=actor.userId,
                    actor_user_name=actor.userName,
                    target_type="approval_document",
                    target_id=document_id,
                    event=event_name,
                    status_before=status_before,
                    status_after=next_status,
                    reason=normalized_reason,
                )
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id), actor)
            connection.commit()
        self._emit_approval_status_event(
            actor=actor,
            document=response,
            event_name=event_name,
            status_before=status_before,
            status_after=next_status,
            reason=normalized_reason,
            forced=forced,
            accepted=accepted,
        )
        return response

    def _fetch_user_view_row(self, cursor, user_id: str) -> dict:
        row = self._fetch_user_access_row(cursor, "u.id = %s", (user_id,))
        if row is None:
            raise ValueError("대상 사용자를 찾을 수 없습니다.")
        return row

    def _require_company(self) -> CompanyRecord:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                return self._to_company_record(self._fetch_company_row(cursor))

    def _assert_user_accessible(self, row: dict) -> None:
        if row["user_status"] != "active":
            raise PermissionError("비활성화된 사용자 계정입니다.")
        if row["role_status"] != "active":
            raise PermissionError("사용자 권한이 비활성화된 상태입니다.")
        if row["mail_account_status"] != "active":
            raise PermissionError("사용자 계정 상태와 메일/권한 상태가 일치하지 않습니다.")

    def _permissions(self, raw: object) -> list[str]:
        if isinstance(raw, list):
            return [str(item) for item in raw]
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed]
            except json.JSONDecodeError:
                return [item.strip() for item in raw.split(",") if item.strip()]
        return []

    def _row_to_auth_summary(self, row: dict) -> AuthUserSummary:
        return AuthUserSummary(
            userId=row["user_id"],
            companyId=row["company_id"],
            userName=row["user_name"],
            userEmail=row["user_email"],
            roleId=row["role_id"],
            roleName=row["role_name"],
            userType=row["user_type"],
            status=row["user_status"],
            permissions=self._permissions(row["permissions"]),
        )

    def _row_to_user_view(self, row: dict) -> UserView:
        permissions = self._permissions(row["permissions"])
        consistency_issues: list[UserStatusIssue] = []
        if row["role_status"] != "active":
            consistency_issues.append(UserStatusIssue(code="ROLE_INACTIVE", message="연결된 권한 역할이 비활성화 상태입니다."))
        if row["user_status"] == "active" and row["mail_account_status"] != "active":
            consistency_issues.append(UserStatusIssue(code="MAIL_ACCOUNT_MISMATCH", message="활성 사용자이지만 메일 계정이 활성 상태가 아닙니다."))
        if row["user_status"] != "active" and row["mail_account_status"] == "active":
            consistency_issues.append(UserStatusIssue(code="USER_INACTIVE_MAIL_ACTIVE", message="비활성 사용자이지만 메일 계정이 활성 상태입니다."))

        return UserView(
            userId=row["user_id"],
            companyId=row["company_id"],
            userName=row["user_name"],
            userEmail=row["user_email"],
            departmentId=row["department_id"],
            departmentName=row["department_name"],
            roleId=row["role_id"],
            roleName=row["role_name"],
            status=row["user_status"],
            userType=row["user_type"],
            mailAccountEmail=row["mail_account_email"],
            mailAccountStatus=row["mail_account_status"],
            permissions=permissions,
            consistencyIssues=consistency_issues,
        )

    def _to_company_record(self, row: dict) -> CompanyRecord:
        return CompanyRecord(
            id=row["id"],
            name=row["name"],
            domain=row["domain"],
            status=row["status"],
            createdAt=row["created_at"],
        )

    def _to_department_record(self, row: dict) -> DepartmentRecord:
        return DepartmentRecord(
            id=row["id"],
            companyId=row["company_id"],
            name=row["name"],
            parentId=row["parent_id"],
            status=row["status"],
            sortOrder=row["sort_order"],
            createdAt=row["created_at"],
        )

    def _to_role_record(self, row: dict) -> RoleRecord:
        return RoleRecord(
            id=row["id"],
            companyId=row["company_id"],
            name=row["name"],
            permissions=self._permissions(row["permissions"]),
            status=row["status"],
            createdAt=row["created_at"],
        )

    def _to_mail_provider_record(self, row: dict) -> MailProviderConfigRecord:
        return MailProviderConfigRecord(
            id=row["id"],
            companyId=row["company_id"],
            providerType=row["provider_type"],
            relayHost=row["relay_host"],
            relayPort=row["relay_port"],
            username=row["username"],
            encryptedPassword=row["encrypted_password"],
            active=row["active"],
            lastTestStatus=row["last_test_status"],
            lastTestMessage=row["last_test_message"],
            updatedAt=row["updated_at"],
        )

    def _to_mail_provider_view(self, row: dict) -> MailProviderConfigView:
        return MailProviderConfigView(
            id=row["id"],
            companyId=row["company_id"],
            providerType=row["provider_type"],
            relayHost=row["relay_host"],
            relayPort=row["relay_port"],
            username=row["username"],
            active=row["active"],
            lastTestStatus=row["last_test_status"],
            lastTestMessage=row["last_test_message"],
            updatedAt=row["updated_at"],
        )

    def _to_audit_view(self, row: dict) -> AuditLogView:
        return AuditLogView(
            id=row["id"],
            event=row["event"],
            actorUserId=row["actor_user_id"],
            actorUserName=row["actor_user_name"],
            targetType=row["target_type"],
            targetId=row["target_id"],
            statusBefore=row["status_before"],
            statusAfter=row["status_after"],
            reason=row["reason"],
            createdAt=row["created_at"],
        )

    def _insert_audit(
        self,
        *,
        cursor,
        company_id: str,
        actor_user_id: str | None,
        actor_user_name: str,
        target_type: str,
        target_id: str,
        event: str,
        status_before: str | None,
        status_after: str | None,
        reason: str | None,
    ) -> None:
        record = AuditLogRecord(
            id=self._new_id("log"),
            event=event,
            actorUserId=actor_user_id,
            actorUserName=actor_user_name,
            targetType=target_type,
            targetId=target_id,
            statusBefore=status_before,
            statusAfter=status_after,
            reason=reason,
            createdAt=self._now(),
        )
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type, target_id,
                event, status_before, status_after, reason, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                record.id,
                company_id,
                record.actorUserId,
                record.actorUserName,
                record.targetType,
                record.targetId,
                record.event,
                record.statusBefore,
                record.statusAfter,
                record.reason,
                record.createdAt,
            ),
        )

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _now(self) -> datetime:
        return datetime.now(UTC)

    def _approval_recipients(
        self,
        document: ApprovalDocumentResponse,
        *,
        include_creator: bool = False,
        include_current: bool = False,
    ) -> list[str]:
        recipients: list[str] = []
        if include_creator:
            recipients.append(document.creatorUserId)
        if include_current and document.currentLineIndex is not None:
            current_line = next((item for item in document.lines if item.sequence == document.currentLineIndex), None)
            if current_line is not None:
                recipients.append(current_line.approverUserId)
        deduped: list[str] = []
        for user_id in recipients:
            if user_id and user_id not in deduped:
                deduped.append(user_id)
        return deduped

    def _emit_approval_status_event(
        self,
        *,
        actor: AuthUserSummary,
        document: ApprovalDocumentResponse,
        event_name: str,
        status_before: str,
        status_after: str,
        reason: str | None,
        forced: bool,
        accepted: bool,
    ) -> None:
        if forced and accepted:
            event_type = "approval.force.approved"
            title = "관리자가 결재를 직권 승인했습니다."
            message = f"{actor.userName} 관리자가 '{document.title}' 문서를 직권 승인했습니다."
            severity = SeverityLevel.WARN
        elif forced and not accepted:
            event_type = "approval.force.rejected"
            title = "관리자가 결재를 직권 반려했습니다."
            message = f"{actor.userName} 관리자가 '{document.title}' 문서를 직권 반려했습니다."
            severity = SeverityLevel.WARN
        elif accepted:
            event_type = "approval.status.changed"
            title = "결재 문서가 승인 처리되었습니다."
            message = f"{actor.userName} 사용자가 '{document.title}' 문서를 승인했습니다."
            severity = SeverityLevel.INFO
        else:
            event_type = "approval.status.changed"
            title = "결재 문서가 반려 처리되었습니다."
            message = f"{actor.userName} 사용자가 '{document.title}' 문서를 반려했습니다."
            severity = SeverityLevel.WARN

        recipients = self._approval_recipients(document, include_creator=True, include_current=True)
        self._emit_approval_event(
            actor=actor,
            document=document,
            event_type=event_type,
            title=title,
            message=message,
            severity=severity,
            status_before=status_before,
            status_after=status_after,
            recipients=recipients,
            extra_payload={
                "auditEvent": event_name,
                "reason": reason,
                "forced": forced,
                "accepted": accepted,
            },
        )

    def _emit_approval_event(
        self,
        *,
        actor: AuthUserSummary,
        document: ApprovalDocumentResponse,
        event_type: str,
        title: str,
        message: str,
        severity: SeverityLevel,
        status_before: str | None,
        status_after: str,
        recipients: list[str],
        extra_payload: dict | None = None,
    ) -> None:
        try:
            payload = {
                "documentId": document.id,
                "title": document.title,
                "statusBefore": status_before,
                "statusAfter": status_after,
                "creatorUserId": document.creatorUserId,
                "currentLineIndex": document.currentLineIndex,
                "lineCount": len(document.lines),
            }
            if extra_payload:
                payload.update(extra_payload)
            ObservabilityService().emit_event(
                EventEnvelope(
                    eventId=f"evt_{uuid4().hex}",
                    eventType=event_type,
                    category=MonitoringCategory.APPROVAL,
                    severity=severity,
                    resourceType="approval_document",
                    resourceId=document.id,
                    requestId=f"req_{uuid4().hex}",
                    dedupKey=f"{event_type}:{document.id}:{status_after}",
                    title=title,
                    message=message,
                    source="directory-store",
                    companyId=actor.companyId,
                    actorUserId=actor.userId,
                    targets=recipients,
                    visibility=Visibility.BOTH,
                    payload=payload,
                )
            )
        except Exception:
            pass
