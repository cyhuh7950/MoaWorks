from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
import unittest

from fastapi import HTTPException
from pydantic import ValidationError


ROOT = Path(__file__).resolve().parent


class Ui041AddressBookTests(unittest.TestCase):
    def test_migration_043_is_additive_and_preserves_contacts(self) -> None:
        sql = (ROOT / "migrations" / "043_address_book.sql").read_text(encoding="utf-8")
        for token in (
            "CREATE TABLE IF NOT EXISTS contact_groups",
            "owner_user_id TEXT NOT NULL REFERENCES users(id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_groups_owner_name_active",
            "WHERE status='active'",
            "ADD COLUMN IF NOT EXISTS group_id",
            "REFERENCES contact_groups(id) ON DELETE SET NULL",
            "CREATE INDEX IF NOT EXISTS idx_personal_contacts_owner_group_status",
        ):
            self.assertIn(token, sql)
        upper = sql.upper()
        self.assertNotIn("DELETE FROM PERSONAL_CONTACTS", upper)
        self.assertNotIn("UPDATE PERSONAL_CONTACTS SET GROUP_ID", upper)

    def test_contact_and_group_payloads_normalize_and_validate(self) -> None:
        from app.schemas.workspace import ContactGroupCreatePayload, ContactGroupUpdatePayload, ContactPayload

        contact = ContactPayload(name="  홍 길동  ", email="  USER@Example.COM ", groupId="group-a")
        self.assertEqual(contact.name, "홍 길동")
        self.assertEqual(contact.email, "user@example.com")
        self.assertEqual(contact.groupId, "group-a")
        self.assertEqual(ContactGroupCreatePayload(name="  영업   팀 ").name, "영업 팀")
        update = ContactGroupUpdatePayload(name="개인", expectedUpdatedAt=datetime.now(UTC))
        self.assertEqual(update.name, "개인")
        with self.assertRaises(ValidationError):
            ContactPayload(name="사용자", email="invalid")
        with self.assertRaises(ValidationError):
            ContactGroupCreatePayload(name="x" * 61)

    def test_routes_keep_legacy_contacts_and_add_groups_public_search_and_import(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "workspace.py").read_text(encoding="utf-8")
        for token in (
            "def list_contacts(",
            "query: str = Query(default=\"\", max_length=120)",
            "groupId: str | None = Query(default=None)",
            "@router.get('/contact-groups'",
            "@router.post('/contact-groups'",
            "@router.patch('/contact-groups/{group_id}'",
            "@router.delete('/contact-groups/{group_id}'",
            "@router.get('/public-contacts'",
            "@router.post('/contacts/import'",
            "UploadFile",
            "expectedDigest",
        ):
            self.assertIn(token, source)

    def test_service_enforces_owner_company_search_and_public_active_boundaries(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        for token in (
            "def list_contact_groups",
            "def create_contact_group",
            "def update_contact_group",
            "def delete_contact_group",
            "def list_public_contacts",
            "def preview_contact_import",
            "def apply_contact_import",
            "owner_user_id=%s",
            "company_id=%s",
            "u.status='active'",
            "r.status='active'",
            "LIMIT 500",
            "group_id=NULL",
            '"workspace.contact_group.created"',
            '"workspace.contact_group.updated"',
            '"workspace.contact_group.deleted"',
            '"workspace.contact.imported"',
        ):
            self.assertIn(token, source)

    def test_csv_parser_uses_utf8_headers_limits_and_digest(self) -> None:
        from app.services.workspace_service import WorkspaceService

        content = "\ufeffname,email,phone,companyName,memo,groupName\n홍길동,user@example.com,010,모아,메모,영업\n".encode("utf-8")
        parsed = WorkspaceService._parse_contact_csv(content)
        self.assertEqual(parsed["digest"], sha256(content).hexdigest())
        self.assertEqual(parsed["rows"][0]["email"], "user@example.com")
        self.assertEqual(parsed["rows"][0]["groupName"], "영업")
        self.assertEqual(parsed["errors"], [])
        missing_header = WorkspaceService._parse_contact_csv(b"name,phone\nA,010\n")
        self.assertTrue(missing_header["errors"])
        with self.assertRaises(HTTPException) as oversized:
            WorkspaceService._validate_contact_import_file("contacts.csv", "text/csv", b"x" * (1024 * 1024 + 1))
        self.assertEqual(oversized.exception.status_code, 413)

    def test_csv_contract_skips_duplicates_and_never_audits_pii(self) -> None:
        source = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        import_section = source[source.index("def _parse_contact_csv"):source.index("def list_files")]
        for token in ("existingEmailCount", "fileDuplicateCount", "groupsToCreate", "expected_digest", "digest[:12]"):
            self.assertIn(token, import_section)
        audit_call = import_section[import_section.index('"workspace.contact.imported"'):]
        self.assertNotIn('row["email"]', audit_call)
        self.assertNotIn('row["name"]', audit_call)
        self.assertNotIn("file_name", audit_call)


if __name__ == "__main__":
    unittest.main()
