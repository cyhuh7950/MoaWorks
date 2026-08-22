import unittest
from pathlib import Path

from app.services.mail_operations_policy import build_mail_domain_contract
from app.services.mail_operations_service import MailOperationsService


class RecordingCursor:
    def __init__(self, queued_rows: list[dict] | None = None, one_rows: list[dict] | None = None) -> None:
        self.queued_rows = queued_rows or []
        self.one_rows = list(one_rows or [])
        self.statements: list[tuple[str, tuple | None]] = []

    def execute(self, query: str, params: tuple | None = None) -> None:
        self.statements.append((" ".join(query.split()), params))

    def fetchall(self) -> list[dict]:
        return self.queued_rows

    def fetchone(self) -> dict | None:
        return self.one_rows.pop(0) if self.one_rows else None


class MailOperationsPersistenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.service = MailOperationsService()

    def test_migration_defines_domain_settings_and_provider_contract(self) -> None:
        migration = Path(__file__).parent / "migrations" / "047_mail_operations.sql"

        sql = migration.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE IF NOT EXISTS mail_domain_settings", sql)
        self.assertIn("admin_access_mode", sql)
        self.assertIn("active_outbound_provider_key", sql)
        self.assertIn("provider_switched_at", sql)
        self.assertIn("CHECK (admin_access_mode IN ('public', 'restricted', 'private'))", sql)
        self.assertNotIn("DROP TABLE", sql.upper())

    def test_save_contract_uses_upsert_without_changing_existing_user_email(self) -> None:
        cursor = RecordingCursor()
        contract = build_mail_domain_contract(
            registered_domain="sinsan.kr",
            mail_domain="moaworks.sinsan.kr",
            admin_access_mode="restricted",
        )

        self.service.save_domain_contract(
            cursor=cursor,
            company_id="cmp-default",
            contract=contract,
            active_provider="oci_email_delivery",
        )

        statements = "\n".join(query for query, _ in cursor.statements)
        self.assertIn("INSERT INTO mail_domain_settings", statements)
        self.assertIn("ON CONFLICT (company_id) DO UPDATE", statements)
        self.assertNotIn("UPDATE users", statements)
        self.assertNotIn("UPDATE mail_accounts", statements)

    def test_split_inbound_mx_host_is_persisted_without_overwriting_mail_host(self) -> None:
        cursor = RecordingCursor()
        contract = build_mail_domain_contract(
            registered_domain="sinsan.kr",
            mail_domain="dev.moaworks.sinsan.kr",
            inbound_mx_host="mx.dev.moaworks.sinsan.kr",
            admin_access_mode="restricted",
        )

        self.service.save_domain_contract(
            cursor=cursor,
            company_id="cmp-default",
            contract=contract,
            active_provider="self_hosted",
        )

        query, params = cursor.statements[0]
        self.assertIn("inbound_mx_host", query)
        self.assertIn("mail.dev.moaworks.sinsan.kr", params)
        self.assertIn("mx.dev.moaworks.sinsan.kr", params)

    def test_migration_adds_backward_compatible_inbound_mx_host(self) -> None:
        migration = Path(__file__).parent / "migrations" / "055_mail_inbound_mx_host.sql"

        sql = migration.read_text(encoding="utf-8")

        self.assertIn("ADD COLUMN IF NOT EXISTS inbound_mx_host", sql)
        self.assertIn("SET inbound_mx_host = mail_host", sql)
        self.assertIn("SET NOT NULL", sql)
        self.assertNotIn("DROP TABLE", sql.upper())

    def test_provider_switch_pins_existing_queue_without_updating_queue_rows(self) -> None:
        cursor = RecordingCursor(
            queued_rows=[
                {"queue_id": "q-1", "provider_key": "oci_email_delivery"},
                {"queue_id": "q-2", "provider_key": "self_hosted"},
            ],
            one_rows=[{"id": "provider-self", "delivery_enabled": True, "last_test_status": "success"}],
        )

        plan = self.service.switch_outbound_provider(
            cursor=cursor,
            company_id="cmp-default",
            actor_user_id="user-admin",
            current_provider="oci_email_delivery",
            target_provider="self_hosted",
        )

        statements = "\n".join(query for query, _ in cursor.statements)
        self.assertEqual(plan.new_message_provider, "self_hosted")
        self.assertEqual(plan.pinned_queue_providers["q-1"], "oci_email_delivery")
        self.assertIn("UPDATE mail_domain_settings", statements)
        self.assertIn("UPDATE mail_provider_configs", statements)
        self.assertIn("UPDATE mail_accounts", statements)
        self.assertIn("account.status <> 'deleted'", statements)
        self.assertIn("INSERT INTO audit_logs", statements)
        self.assertNotIn("UPDATE mail_delivery_queue", statements)

        account_update = next(
            (params for query, params in cursor.statements if "UPDATE mail_accounts" in query),
            None,
        )
        self.assertEqual(account_update[0], "provider-self")
        self.assertEqual(account_update[2], "cmp-default")

    def test_provider_rollback_restores_previous_provider_without_rewriting_queue(self) -> None:
        cursor = RecordingCursor(
            queued_rows=[],
            one_rows=[
                {"active_outbound_provider_key": "oci_email_delivery", "previous_outbound_provider_key": "self_hosted"},
                {"id": "provider-self", "delivery_enabled": True, "last_test_status": "success"},
            ],
        )

        plan = self.service.rollback_outbound_provider(
            cursor=cursor,
            company_id="cmp-default",
            actor_user_id="user-admin",
        )

        statements = "\n".join(f"{query} {params}" for query, params in cursor.statements)
        self.assertEqual(plan.new_message_provider, "self_hosted")
        self.assertIn("mail.outbound_provider.rolled_back", statements)
        self.assertNotIn("UPDATE mail_delivery_queue", statements)


if __name__ == "__main__":
    unittest.main()
