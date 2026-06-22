from __future__ import annotations

from datetime import UTC, datetime
import json
from uuid import uuid4

from app.schemas.directory import (
    ApprovalActionReason,
    ApprovalCreateResponse,
    ApprovalDocumentCreateRequest,
    ApprovalDocumentResponse,
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
from app.schemas.setup import SetupInitializeRequest
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService


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
        role_permissions = permissions or ["mail:read", "approval:read", "approval:create"]

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

    def list_approval_documents(self, actor_id: str) -> ApprovalListResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                rows = self._fetch_visible_approval_rows(cursor, actor)
                documents = [self._to_approval_document_response(cursor, row) for row in rows]
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
                              )
                            ORDER BY al.created_at DESC
                            """,
                            (actor.companyId, actor.userId, actor.userId),
                        )
                rows = cursor.fetchall()
        return AuditLogListResponse(logs=[self._to_audit_view(row) for row in rows])

    def get_approval_document(self, actor_id: str, document_id: str) -> ApprovalDocumentResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
                row = self._fetch_required_approval_document(cursor, document_id)
                self._assert_approval_visible(cursor, actor, row)
                return self._to_approval_document_response(cursor, row)

    def create_approval_document(self, actor_id: str, payload: ApprovalDocumentCreateRequest) -> ApprovalCreateResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        document_id = self._new_id("doc")

        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                actor = self._fetch_actor_summary(cursor, actor_id)
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
                for sequence, approver_user_id in enumerate(payload.approverUserIds, start=1):
                    approver = self._fetch_actor_summary(cursor, approver_user_id)
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
                            approver.userId,
                            approver.userName,
                            sequence,
                            "pending",
                            None,
                            None,
                            None,
                        ),
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
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id))
            connection.commit()
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
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id))
            connection.commit()
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
                        decided_at = NULL
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
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id))
            connection.commit()
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
                id,
                document_id,
                approver_user_id,
                approver_user_name,
                sequence,
                status,
                comment,
                decided_by_user_id,
                decided_at
            FROM approval_lines
            WHERE document_id = %s
            ORDER BY sequence ASC
        """
        if for_update:
            query += " FOR UPDATE"
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
                  )
                ORDER BY ad.updated_at DESC, ad.created_at DESC
                """,
                (actor.companyId, actor.userId, actor.userId),
            )
        return list(cursor.fetchall())

    def _assert_approval_visible(self, cursor, actor: AuthUserSummary, document: dict) -> None:
        if self._can_view_all_approvals(actor):
            return
        if document["creator_user_id"] == actor.userId:
            return
        cursor.execute(
            "SELECT 1 FROM approval_lines WHERE document_id = %s AND approver_user_id = %s",
            (document["id"], actor.userId),
        )
        if cursor.fetchone() is not None:
            return
        raise PermissionError("대상 결재 문서에 접근할 수 없습니다.")

    def _to_approval_document_response(self, cursor, row: dict) -> ApprovalDocumentResponse:
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
                decidedAt=line["decided_at"],
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
            lines=lines,
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
                        raise PermissionError("현재 결재선의 담당자만 처리할 수 있습니다.")

                if accepted:
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
                                decided_at = %s
                            WHERE id = %s
                            """,
                            (normalized_reason, actor.userId, now, target_line["id"]),
                        )
                        remaining_pending = [line for line in lines if line["sequence"] > target_line["sequence"] and line["status"] == "pending"]
                        next_status = "approved" if not remaining_pending else "submitted"
                        next_line_index = None if next_status == "approved" else remaining_pending[0]["sequence"]
                        event_name = "approval.approved"
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
                                decided_at = %s
                            WHERE id = %s
                            """,
                            (normalized_reason, actor.userId, now, target_line["id"]),
                        )
                        event_name = "approval.rejected"
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
                response = self._to_approval_document_response(cursor, self._fetch_required_approval_document(cursor, document_id))
            connection.commit()
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
