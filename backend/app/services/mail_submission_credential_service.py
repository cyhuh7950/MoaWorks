from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import settings
from app.schemas.mail_submission import MailSubmissionCredentialIssueResponse, MailSubmissionCredentialView
from app.services.mail_submission_credentials import build_submission_username, generate_submission_password, hash_submission_password
from app.services.postgres_service import PostgresService


class MailSubmissionCredentialService:
    def __init__(self, db=None) -> None:
        self.db = db or PostgresService()

    def list_credentials(self, actor) -> list[MailSubmissionCredentialView]:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """SELECT c.user_id, u.name AS user_name, u.email AS user_email,
                              c.username, c.active, c.issued_at, c.revoked_at
                       FROM mail_submission_credentials c
                       JOIN users u ON u.id = c.user_id AND u.company_id = c.company_id
                       WHERE c.company_id=%s ORDER BY u.name, u.email""",
                    (actor.companyId,),
                )
                rows = cursor.fetchall()
        return [MailSubmissionCredentialView(
            userId=row["user_id"], userName=row["user_name"], userEmail=row["user_email"],
            username=row["username"], active=bool(row["active"]),
            issuedAt=row["issued_at"].isoformat() if row.get("issued_at") else None,
            revokedAt=row["revoked_at"].isoformat() if row.get("revoked_at") else None,
        ) for row in rows]

    def issue(self, actor, user_id: str) -> MailSubmissionCredentialIssueResponse:
        self.db.ensure_migrations_applied()
        now = datetime.now(UTC)
        password = generate_submission_password()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT id, email, status FROM users WHERE id=%s AND company_id=%s FOR UPDATE", (user_id, actor.companyId))
                user = cursor.fetchone()
                if user is None or user["status"] != "active":
                    raise ValueError("활성 사용자만 SMTP 암호를 발급할 수 있습니다.")
                cursor.execute("SELECT mail_host FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                domain = cursor.fetchone()
                if domain is None or not domain.get("mail_host"):
                    raise ValueError("메일 호스트를 먼저 설정해야 합니다.")
                username = build_submission_username(user["email"])
                cursor.execute(
                    """INSERT INTO mail_submission_credentials
                       (id, company_id, user_id, username, password_hash, active, issued_at, revoked_at, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,%s,TRUE,%s,NULL,%s,%s)
                       ON CONFLICT (company_id,user_id) DO UPDATE SET
                         username=EXCLUDED.username, password_hash=EXCLUDED.password_hash,
                         active=TRUE, issued_at=EXCLUDED.issued_at, revoked_at=NULL, updated_at=EXCLUDED.updated_at""",
                    (f"smtpcred_{uuid4().hex[:12]}", actor.companyId, user_id, username, hash_submission_password(password), now, now, now),
                )
            connection.commit()
        return MailSubmissionCredentialIssueResponse(username=username, password=password, smtpHost=domain["mail_host"], smtpPort=587, secure=True)

    def revoke(self, actor, user_id: str) -> MailSubmissionCredentialView:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """UPDATE mail_submission_credentials c SET active=FALSE, revoked_at=NOW(), updated_at=NOW()
                       WHERE c.company_id=%s AND c.user_id=%s
                       RETURNING c.user_id, c.username, c.active, c.issued_at, c.revoked_at""",
                    (actor.companyId, user_id),
                )
                row = cursor.fetchone()
                if row is None:
                    raise ValueError("SMTP 암호를 찾을 수 없습니다.")
                cursor.execute("SELECT name, email FROM users WHERE id=%s AND company_id=%s", (user_id, actor.companyId))
                user = cursor.fetchone()
            connection.commit()
        return MailSubmissionCredentialView(userId=user_id, userName=user["name"], userEmail=user["email"], username=row["username"], active=False, issuedAt=row["issued_at"].isoformat(), revokedAt=row["revoked_at"].isoformat())
