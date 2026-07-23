from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
import unittest

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.mail import _handle_error
from app.schemas.mail_messenger import (
    MailSignatureBulkDeleteRequest,
    MailSignatureCreateRequest,
    MailSignatureDeleteItem,
    MailSignaturePreferencesUpdateRequest,
    MailSignatureUpdateRequest,
)
from app.services.mail_messenger_service import MailMessengerService, MailSignatureConflictError


def signature_row(signature_id: str, version: int = 1, *, updated_offset: int = 0) -> dict:
    now = datetime(2026, 7, 23, 1, 0, updated_offset, tzinfo=UTC)
    return {
        "id": signature_id,
        "company_id": "company-a",
        "owner_user_id": "user-a",
        "name": f"서명 {signature_id}",
        "content_text": f"내용 {signature_id}",
        "version": version,
        "created_at": now,
        "updated_at": now,
    }


class SignatureDeleteCursor:
    def __init__(self, signatures: list[dict], default_id: str | None, *, enabled: bool = True):
        self.signatures = {item["id"]: dict(item) for item in signatures}
        self.preferences = {
            "owner_user_id": "user-a",
            "company_id": "company-a",
            "enabled": enabled,
            "position": "body_bottom",
            "default_signature_id": default_id,
            "version": 3,
            "updated_at": datetime.now(UTC),
        }
        self.next_one = None
        self.next_all: list[dict] = []
        self.executions: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        upper = normalized.upper()
        params = tuple(params)
        self.executions.append((normalized, params))
        self.next_one = None
        self.next_all = []
        if upper.startswith("SELECT ID FROM USERS"):
            self.next_one = {"id": "user-a"} if params == ("user-a", "company-a") else None
        elif upper.startswith("INSERT INTO USER_MAIL_SIGNATURE_PREFERENCES"):
            return
        elif upper.startswith("SELECT * FROM USER_MAIL_SIGNATURE_PREFERENCES"):
            self.next_one = dict(self.preferences) if params == ("company-a", "user-a") else None
        elif upper.startswith("SELECT * FROM USER_MAIL_SIGNATURES") and "FOR UPDATE" in upper:
            signature_id, company_id, owner_id = params
            row = self.signatures.get(signature_id)
            self.next_one = dict(row) if row and company_id == "company-a" and owner_id == "user-a" else None
        elif upper.startswith("DELETE FROM USER_MAIL_SIGNATURES"):
            signature_id, company_id, owner_id, version = params
            row = self.signatures.get(signature_id)
            if row and company_id == "company-a" and owner_id == "user-a" and row["version"] == version:
                del self.signatures[signature_id]
        elif upper.startswith("SELECT ID FROM USER_MAIL_SIGNATURES"):
            rows = sorted(self.signatures.values(), key=lambda item: (item["updated_at"], item["id"]), reverse=True)
            self.next_one = {"id": rows[0]["id"]} if rows else None
        elif upper.startswith("UPDATE USER_MAIL_SIGNATURE_PREFERENCES"):
            next_default = params[0]
            expected_version = params[-1]
            if expected_version == self.preferences["version"]:
                self.preferences["default_signature_id"] = next_default
                if next_default is None:
                    self.preferences["enabled"] = False
                self.preferences["version"] += 1
                self.preferences["updated_at"] = params[2]
                self.next_one = dict(self.preferences)
        elif upper.startswith("SELECT * FROM USER_MAIL_SIGNATURES"):
            self.next_all = sorted(
                (dict(item) for item in self.signatures.values()),
                key=lambda item: (item["updated_at"], item["id"]),
                reverse=True,
            )

    def fetchone(self):
        value, self.next_one = self.next_one, None
        return value

    def fetchall(self):
        values, self.next_all = self.next_all, []
        return values


class SignatureConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.commits += 1


class SignatureDb:
    def __init__(self, cursor):
        self.connection = SignatureConnection(cursor)

    def ensure_migrations_applied(self):
        return None

    def connect(self):
        return self.connection


class Ui023MailSignatureTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_027_is_idempotent_scoped_and_case_insensitive(self):
        sql = (self.root / "migrations" / "027_mail_signatures.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists user_mail_signatures",
            "create table if not exists user_mail_signature_preferences",
            "owner_user_id text not null references users(id)",
            "owner_user_id text primary key references users(id)",
            "check (position in ('body_top', 'body_bottom'))",
            "create unique index if not exists uq_user_mail_signatures_owner_name_ci",
            "lower(name)",
            "foreign key (default_signature_id, company_id, owner_user_id)",
            "references user_mail_signatures(id, company_id, owner_user_id)",
            "deferrable initially deferred",
        ):
            self.assertIn(marker, sql)
        self.assertNotIn("on delete set null", sql)

    def test_signature_input_normalization_and_validation(self):
        created = MailSignatureCreateRequest(name="  회사   서명  ", contentText="\r\n안녕하세요\r\n감사합니다.\r\n")
        self.assertEqual(created.name, "회사 서명")
        self.assertEqual(created.contentText, "안녕하세요\n감사합니다.")
        invalid_values = (
            {"name": "안전\n위조", "contentText": "본문"},
            {"name": "안전\x07위조", "contentText": "본문"},
            {"name": "안전\t위조", "contentText": "본문"},
            {"name": "서명", "contentText": "본문\x00위조"},
            {"name": "서명", "contentText": "본문\x07위조"},
            {"name": "x" * 51, "contentText": "본문"},
            {"name": "서명", "contentText": "x" * 4001},
        )
        for value in invalid_values:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                MailSignatureCreateRequest(**value)
        with self.assertRaises(ValidationError):
            MailSignatureUpdateRequest(name="서명", contentText="본문", expectedVersion=0)
        with self.assertRaises(ValidationError):
            MailSignaturePreferencesUpdateRequest(enabled=True, position="body_bottom", defaultSignatureId=None, expectedVersion=1)

    def test_duplicate_name_is_signature_conflict_and_route_maps_to_409(self):
        cursor = SignatureDeleteCursor([], None)
        cursor.signatures["existing"] = signature_row("existing")
        cursor.next_one = {"id": "existing"}
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자")
        service = MailMessengerService()
        captured = None
        try:
            service._assert_signature_name_available(cursor, actor, "서명 existing")
        except Exception as exc:
            captured = exc
        self.assertIsInstance(captured, MailSignatureConflictError)
        with self.assertRaises(HTTPException) as captured:
            _handle_error(MailSignatureConflictError("충돌"))
        self.assertEqual(captured.exception.status_code, 409)
        self.assertEqual(captured.exception.detail["code"], "MAIL_SIGNATURE_CONFLICT")

    def test_lock_and_crud_queries_are_company_and_owner_scoped(self):
        cursor = SignatureDeleteCursor([signature_row("owned")], "owned")
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자")
        service = MailMessengerService()
        service.db = SignatureDb(cursor)
        service._lock_signature_owner(cursor, actor)
        lock_sql, lock_params = cursor.executions[-1]
        self.assertIn("company_id = %s FOR UPDATE", lock_sql)
        self.assertEqual(lock_params, ("user-a", "company-a"))
        with self.assertRaises(PermissionError):
            service.update_signature(
                SimpleNamespace(companyId="company-b", userId="user-b", userName="외부"),
                "owned",
                MailSignatureUpdateRequest(name="수정", contentText="본문", expectedVersion=1),
            )

    def test_bulk_delete_is_atomic_on_stale_version(self):
        cursor = SignatureDeleteCursor([signature_row("one"), signature_row("two", version=2)], "one")
        service = MailMessengerService()
        service.db = SignatureDb(cursor)
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자")
        payload = MailSignatureBulkDeleteRequest(items=[
            MailSignatureDeleteItem(signatureId="one", expectedVersion=1),
            MailSignatureDeleteItem(signatureId="two", expectedVersion=1),
        ])
        with self.assertRaises(MailSignatureConflictError):
            service.bulk_delete_signatures(actor, payload)
        self.assertEqual(set(cursor.signatures), {"one", "two"})
        self.assertEqual(service.db.connection.commits, 0)

    def test_default_delete_promotes_latest_and_last_delete_disables_with_version_increment(self):
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자")
        cursor = SignatureDeleteCursor(
            [signature_row("default", updated_offset=1), signature_row("latest", updated_offset=2)],
            "default",
        )
        service = MailMessengerService()
        service.db = SignatureDb(cursor)
        response = service.delete_signature(actor, "default", 1)
        self.assertEqual(response.defaultSignatureId, "latest")
        self.assertTrue(response.enabled)
        self.assertEqual(response.version, 4)

        last_cursor = SignatureDeleteCursor([signature_row("last")], "last")
        last_service = MailMessengerService()
        last_service.db = SignatureDb(last_cursor)
        last_response = last_service.delete_signature(actor, "last", 1)
        self.assertIsNone(last_response.defaultSignatureId)
        self.assertFalse(last_response.enabled)
        self.assertEqual(last_response.version, 4)

    def test_signature_audit_contains_field_names_not_actual_name_or_body(self):
        cursor = SignatureDeleteCursor([], None)
        actor = SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자")
        MailMessengerService()._write_signature_audit(
            cursor, actor, "sig-a", "mail.signature.updated", ["name", "contentText"], datetime.now(UTC)
        )
        _, params = cursor.executions[-1]
        serialized = " ".join(str(item) for item in params)
        self.assertIn("changedFields", serialized)
        self.assertNotIn("기밀 서명 이름", serialized)
        self.assertNotIn("기밀 서명 본문", serialized)

    def test_plain_and_html_signature_composition_is_escaped_and_once(self):
        service = MailMessengerService()
        signature = {"content_text": "<관리자>\n감사합니다.", "position": "body_bottom"}
        text, html = service._compose_signature_body("본문", "<p>본문</p>", signature)
        self.assertEqual(text, "본문\n\n-- \n<관리자>\n감사합니다.")
        self.assertIn("&lt;관리자&gt;", html)
        self.assertNotIn("<관리자>", html)
        self.assertEqual(text.count("-- "), 1)
        top_text, top_html = service._compose_signature_body("본문", None, {**signature, "position": "body_top"})
        self.assertEqual(top_text, "<관리자>\n감사합니다.\n\n-- \n본문")
        self.assertIsNone(top_html)

    def test_save_mail_fetches_and_composes_the_server_signature_once(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        save_mail = source[source.index("    def _save_mail("):]
        self.assertEqual(save_mail.count("self._fetch_enabled_signature(cursor, actor)"), 1)
        self.assertEqual(
            save_mail.count(
                "self._compose_signature_body(payload.bodyText, payload.bodyHtml, signature)"
            ),
            1,
        )

    def test_signature_routes_and_same_origin_ui_contract(self):
        route = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        api = (self.root.parent / "frontend" / "user-web" / "src" / "api.ts").read_text(encoding="utf-8")
        ui = (self.root.parent / "frontend" / "user-web" / "src" / "App.tsx").read_text(encoding="utf-8")
        for marker in (
            '@router.get("/signatures"', '@router.post("/signatures"',
            '@router.put("/signatures/{signature_id}"', '@router.delete("/signatures/{signature_id}"',
            '@router.post("/signatures/bulk-delete"', '@router.put("/signatures/preferences"',
        ):
            self.assertIn(marker, route)
        self.assertIn('request<MailSignaturePreferences>("/mail/signatures"', api)
        self.assertNotIn("NEXT_PUBLIC_API_BASE_URL", api)
        for marker in ("서명 추가", "선택 삭제", "본문 상단", "본문 하단", "기본 서명"):
            self.assertIn(marker, ui)
        self.assertIn(
            "form.makeDefault && confirmed.defaultSignatureId !== signature.signatureId",
            ui,
        )

    def test_compose_entry_refreshes_latest_signature_without_blocking_and_popup_uses_snapshot_dirty(self):
        ui = (self.root.parent / "frontend" / "user-web" / "src" / "App.tsx").read_text(encoding="utf-8")
        self.assertIn("async function refreshMailSignaturesForCompose()", ui)
        self.assertGreaterEqual(ui.count("void refreshMailSignaturesForCompose();"), 2)
        self.assertIn('tone: "warning"', ui)
        self.assertIn("최신 서명을 불러오지 못했습니다.", ui)
        self.assertIn(
            "dirty={isMailSignatureEditorDirty(editorInitialForm, editorForm)}",
            ui,
        )
        self.assertIn("closeRequestRef={editorCloseRequestRef}", ui)
        self.assertIn("editorCloseRequestRef.current?.()", ui)


if __name__ == "__main__":
    unittest.main()
