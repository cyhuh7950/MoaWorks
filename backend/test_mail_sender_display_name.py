"""실제 목록 SQL을 SQLite에서 실행하는 이름 해석 회귀 시험."""
import sqlite3
from contextlib import contextmanager

from app.schemas.directory import AuthUserSummary
from app.services.mail_messenger_service import MailMessengerService


class QueryDb:
    def __init__(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.create_function("BTRIM", 1, lambda value: value.strip() if value else value)

    def ensure_migrations_applied(self):
        pass

    @contextmanager
    def connect(self):
        yield self

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, query, params=()):
        self.result = self.connection.execute(query.replace("%s", "?"), params)

    def fetchall(self):
        return [dict(row) for row in self.result.fetchall()]


def test_list_inbox_and_sent_resolve_legacy_name_by_company_and_email():
    db = QueryDb()
    try:
        db.connection.executescript("""
            CREATE TABLE users (id TEXT, company_id TEXT, email TEXT, name TEXT);
            CREATE TABLE mail_messages (
                id TEXT, company_id TEXT, sender_user_id TEXT, sender_account_id TEXT,
                sender_email TEXT, sender_display_name TEXT, subject TEXT, status TEXT,
                sent_at TEXT, scheduled_at TEXT, retention_expires_at TEXT,
                attachment_count INTEGER, created_at TEXT, sender_deleted_at TEXT,
                sender_purged_at TEXT, sender_copy_saved BOOLEAN
            );
            CREATE TABLE mail_recipients (
                message_id TEXT, recipient_user_id TEXT, recipient_email TEXT,
                is_read BOOLEAN, is_starred BOOLEAN, received_at TEXT,
                inbox_category TEXT, deleted_at TEXT, purged_at TEXT,
                is_spam BOOLEAN, folder_id TEXT
            );
            INSERT INTO users VALUES ('other', 'other-company', 'admin@example.test', '다른 회사');
            INSERT INTO users VALUES ('admin', 'company-a', 'admin@example.test', '실제 사용자 이름');
        """)
        for mail_id, email, header_name in [
            ("legacy", "ADMIN@example.test", ""),
            ("explicit", "admin@example.test", "지정 표시명"),
            ("external", "external@example.net", ""),
            ("external-header", "external@example.net", "외부 발신자"),
        ]:
            db.connection.execute(
                "INSERT INTO mail_messages VALUES (?, 'company-a', 'admin', 'account-a', ?, ?, '시험', 'sent', '2026-08-28T00:00:00Z', NULL, '2026-09-28T00:00:00Z', 0, '2026-08-28T00:00:00Z', NULL, NULL, TRUE)",
                (mail_id, email, header_name),
            )
            db.connection.execute(
                "INSERT INTO mail_recipients VALUES (?, 'admin', 'admin@example.test', TRUE, FALSE, '2026-08-28T00:00:00Z', 'primary', NULL, NULL, FALSE, NULL)",
                (mail_id,),
            )
        actor = AuthUserSummary(userId="admin", companyId="company-a", userName="실제 사용자 이름",
                               userEmail="admin@example.test", roleId="role-a", roleName="사용자",
                               userType="user", status="active", permissions=["mail:read"])
        service = object.__new__(MailMessengerService)
        service.db = db
        for listing in (service.list_inbox, service.list_sent):
            rows = {mail.mailId: mail.senderDisplayName for mail in listing(actor).mails}
            assert rows == {
                "legacy": "실제 사용자 이름",
                "explicit": "지정 표시명",
                "external": "",
                "external-header": "외부 발신자",
            }
    finally:
        db.connection.close()
