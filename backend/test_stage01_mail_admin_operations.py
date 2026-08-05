import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.dependencies import require_admin
from app.main import app
from app.schemas.mail_operations import MailOperationsDomainUpdateRequest, MailOperationsProviderUpdateRequest
from app.services.mail_admin_operations import MailAdminOperations
from app.services.mail_operations_policy import ProviderSwitchPlan, build_mail_domain_contract
from app.services.oci_email_operations import OciEmailGateway, OciEmailOperations


class RecordingCursor:
    def __init__(self, one_rows=None, all_rows=None) -> None:
        self.statements: list[tuple[str, tuple | None]] = []
        self.one_rows = list(one_rows or [])
        self.all_rows = list(all_rows or [])

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def execute(self, query: str, params: tuple | None = None) -> None:
        self.statements.append((" ".join(query.split()), params))

    def fetchone(self):
        return self.one_rows.pop(0) if self.one_rows else None

    def fetchall(self):
        return self.all_rows.pop(0) if self.all_rows else []


class FakeConnection:
    def __init__(self, cursor: RecordingCursor) -> None:
        self._cursor = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def cursor(self) -> RecordingCursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1


class FakeDb:
    def __init__(self, *cursors: RecordingCursor) -> None:
        self.connections = [FakeConnection(cursor) for cursor in cursors]
        self.migrations_checked = False

    def ensure_migrations_applied(self) -> None:
        self.migrations_checked = True

    def connect(self) -> FakeConnection:
        return self.connections.pop(0)


def actor():
    return SimpleNamespace(companyId="company-1", userId="admin-1", userName="관리자", permissions=["admin:*"])


class PagingClient:
    def __init__(self) -> None:
        self.suppression_pages = 0

    def list_suppressions(self, _tenancy_id: str, **kwargs):
        self.suppression_pages += 1
        if kwargs.get("page") == "page-2":
            return SimpleNamespace(data=[SimpleNamespace(email_address="b@example.net", reason="COMPLAINT", time_created=None)], headers={})
        return SimpleNamespace(data=[SimpleNamespace(email_address="A@Example.net", reason="HARD_BOUNCE", time_created=None)], headers={"opc-next-page": "page-2"})

    def list_senders(self, _compartment_id: str, **_kwargs):
        return SimpleNamespace(data=[SimpleNamespace(email_address="noreply@moaworks.sinsan.kr", lifecycle_state="ACTIVE")], headers={})

    def list_email_domains(self, _compartment_id: str, **_kwargs):
        return SimpleNamespace(data=[SimpleNamespace(name="moaworks.sinsan.kr", lifecycle_state="ACTIVE")], headers={})


class MailAdminOperationsContractTest(unittest.TestCase):
    def test_domain_contract_canonicalizes_admin_cidrs(self) -> None:
        contract = build_mail_domain_contract(
            registered_domain="sinsan.kr",
            mail_domain="moaworks.sinsan.kr",
            admin_access_mode="restricted",
            admin_allowed_cidrs=["203.0.113.8/24", "2001:db8::1/64"],
        )

        self.assertEqual(contract.admin_allowed_cidrs, ("203.0.113.0/24", "2001:db8::/64"))

    def test_restricted_mode_requires_at_least_one_cidr(self) -> None:
        with self.assertRaisesRegex(ValueError, "CIDR"):
            build_mail_domain_contract(
                registered_domain="sinsan.kr",
                mail_domain="moaworks.sinsan.kr",
                admin_access_mode="restricted",
                admin_allowed_cidrs=[],
            )

    def test_admin_api_exposes_complete_mail_operations_boundary(self) -> None:
        paths = app.openapi()["paths"]
        expected = {
            "/api/v1/admin/mail-operations": "get",
            "/api/v1/admin/mail-operations/domain": "put",
            "/api/v1/admin/mail-operations/providers/{provider_key}": "put",
            "/api/v1/admin/mail-operations/providers/{provider_key}/test": "post",
            "/api/v1/admin/mail-operations/providers/switch": "post",
            "/api/v1/admin/mail-operations/providers/rollback": "post",
            "/api/v1/admin/mail-operations/oci/suppressions/sync": "post",
        }
        for path, method in expected.items():
            with self.subTest(path=path):
                self.assertIn(path, paths)
                self.assertIn(method, paths[path])

    def test_provider_view_never_returns_credentials_or_dkim_private_key(self) -> None:
        view = MailAdminOperations._provider_view(
            {
                "id": "provider-1", "provider_type": "oci_email_delivery", "active": True,
                "username": "smtp-user", "encrypted_password": "cipher-password",
                "encrypted_dkim_private_key": "cipher-dkim", "last_test_status": "success",
            }
        )
        serialized = str(view)
        self.assertNotIn("cipher-password", serialized)
        self.assertNotIn("cipher-dkim", serialized)
        self.assertTrue(view["passwordConfigured"])
        self.assertTrue(view["dkimPrivateKeyConfigured"])

    def test_oci_gateway_paginates_and_reports_sender_and_domain_state(self) -> None:
        client = PagingClient()
        with patch("app.services.oci_email_operations.settings.oci_tenancy_id", "ocid1.tenancy.test"), patch(
            "app.services.oci_email_operations.settings.oci_compartment_id", "ocid1.compartment.test"
        ):
            snapshot = OciEmailGateway(client_factory=lambda: client).snapshot("moaworks.sinsan.kr")
        self.assertEqual([item["email"] for item in snapshot.suppressions], ["a@example.net", "b@example.net"])
        self.assertEqual(snapshot.approved_senders[0]["status"], "ACTIVE")
        self.assertEqual(snapshot.email_domains[0]["status"], "ACTIVE")
        self.assertEqual(client.suppression_pages, 2)

    def test_oci_sync_replaces_active_snapshot_and_writes_audit(self) -> None:
        snapshot_gateway = SimpleNamespace(
            snapshot=lambda _domain: SimpleNamespace(
                suppressions=({"email": "blocked@example.net", "reason": "HARD_BOUNCE"},),
                approved_senders=(), email_domains=(),
            )
        )
        cursor = RecordingCursor()
        result = OciEmailOperations(gateway=snapshot_gateway).sync(
            cursor=cursor, company_id="company-1", actor_user_id="admin-1",
            actor_user_name="관리자", mail_domain="moaworks.sinsan.kr",
        )
        sql = "\n".join(query for query, _ in cursor.statements)
        self.assertIn("SET active=FALSE", sql)
        self.assertIn("ON CONFLICT(company_id,recipient_email)", sql)
        self.assertIn("mail.oci_suppression.synced", sql)
        self.assertEqual(result["suppressionCount"], 1)

    def test_overview_reports_domain_provider_queue_feedback_and_suppression(self) -> None:
        cursor = RecordingCursor(
            one_rows=[
                {
                    "registered_domain": "sinsan.kr", "mail_domain": "moaworks.sinsan.kr",
                    "user_host": "user.moaworks.sinsan.kr", "admin_host": "admin.moaworks.sinsan.kr",
                    "mail_host": "mail.moaworks.sinsan.kr", "admin_access_mode": "restricted",
                    "admin_allowed_cidrs": ["203.0.113.0/24"], "active_outbound_provider_key": "self_hosted",
                    "previous_outbound_provider_key": None, "provider_switched_at": None,
                },
                {"count": 2, "last_seen_at": None},
                {"count": 3},
            ],
            all_rows=[
                [{"id": "provider-1", "provider_type": "self_hosted", "active": True, "last_test_status": "success"}],
                [{"status": "queued", "count": 4}],
            ],
        )
        db = FakeDb(cursor)
        result = MailAdminOperations(db=db).get_overview(actor())
        self.assertTrue(db.migrations_checked)
        self.assertEqual(result["domain"]["adminAllowedCidrs"], ["203.0.113.0/24"])
        self.assertEqual(result["queue"]["queued"], 4)
        self.assertEqual(result["ociSuppression"]["activeCount"], 2)
        self.assertEqual(result["feedbackCount"], 3)

    def test_update_provider_encrypts_secrets_and_locks_changed_connection(self) -> None:
        current = {
            "id": "provider-oci", "provider_type": "oci_email_delivery", "relay_host": "old.example",
            "relay_port": 587, "tls_mode": "starttls", "from_address": "old@example.net", "username": "old",
            "encrypted_password": "old-cipher", "active": False, "delivery_enabled": True,
            "last_test_status": "success", "encrypted_dkim_private_key": None,
        }
        updated = {**current, "relay_host": "smtp.email.ap-seoul-1.oci.oraclecloud.com", "delivery_enabled": False, "last_test_status": "untested", "encrypted_password": "cipher"}
        cursor = RecordingCursor(one_rows=[current, updated])
        operation = MailAdminOperations(db=FakeDb(cursor))
        with patch.object(operation.security, "encrypt_secret", return_value="cipher") as encrypt:
            result = operation.update_provider(
                actor(), "oci_email_delivery",
                MailOperationsProviderUpdateRequest(relayHost=updated["relay_host"], password="smtp-password"),
            )
        self.assertEqual(encrypt.call_args.args[0], "smtp-password")
        self.assertFalse(result["deliveryEnabled"])
        self.assertNotIn("smtp-password", str(result))
        self.assertIn("last_test_status=%s", cursor.statements[1][0])

    def test_oci_provider_accepts_managed_dkim_without_private_key(self) -> None:
        current = {
            "id": "provider-oci", "provider_type": "oci_email_delivery", "relay_host": "smtp.example",
            "relay_port": 587, "tls_mode": "starttls", "from_address": "admin@example.net", "username": "smtp-user",
            "encrypted_password": "cipher", "active": False, "delivery_enabled": False,
            "last_test_status": "untested", "dkim_domain": None, "dkim_selector": None,
            "encrypted_dkim_private_key": None,
        }
        updated = {
            **current,
            "dkim_domain": "mail.example.net",
            "dkim_selector": "oci202608",
            "last_test_message": "설정 변경 후 재검증이 필요합니다.",
        }
        cursor = RecordingCursor(one_rows=[current, updated])
        result = MailAdminOperations(db=FakeDb(cursor)).update_provider(
            actor(),
            "oci_email_delivery",
            MailOperationsProviderUpdateRequest(dkimDomain="mail.example.net", dkimSelector="oci202608"),
        )
        self.assertEqual(result["dkimDomain"], "mail.example.net")
        self.assertEqual(result["dkimSelector"], "oci202608")
        self.assertFalse(result["dkimPrivateKeyConfigured"])

    def test_self_hosted_provider_still_requires_dkim_private_key(self) -> None:
        current = {
            "id": "provider-self", "provider_type": "self_hosted", "relay_host": "localhost",
            "relay_port": 25, "tls_mode": "none", "username": "", "encrypted_password": None,
            "active": True, "delivery_enabled": True, "last_test_status": "success",
            "dkim_domain": None, "dkim_selector": None, "encrypted_dkim_private_key": None,
        }
        operation = MailAdminOperations(db=FakeDb(RecordingCursor(one_rows=[current])))
        with self.assertRaisesRegex(ValueError, "개인키"):
            operation.update_provider(
                actor(),
                "self_hosted",
                MailOperationsProviderUpdateRequest(dkimDomain="mail.example.net", dkimSelector="selector1"),
            )

    def test_missing_provider_is_created_locked_without_plaintext_secret(self) -> None:
        created = {
            "id": "provider-self", "provider_type": "self_hosted", "relay_host": "localhost",
            "relay_port": 25, "username": "", "encrypted_password": "empty-cipher", "active": False,
            "delivery_enabled": False, "tls_mode": "none", "last_test_status": "untested",
        }
        cursor = RecordingCursor(one_rows=[None, created])
        operation = MailAdminOperations(db=FakeDb(cursor))
        with patch.object(operation.security, "encrypt_secret", return_value="empty-cipher"):
            result = operation.update_provider(actor(), "self_hosted", MailOperationsProviderUpdateRequest())
        self.assertFalse(result["deliveryEnabled"])
        self.assertTrue(result["passwordConfigured"])
        self.assertNotIn("empty-cipher", str(result))
        self.assertIn("INSERT INTO mail_provider_configs", cursor.statements[1][0])

    def test_domain_creation_uses_current_provider_when_domain_state_is_absent(self) -> None:
        cursor = RecordingCursor(one_rows=[None, {"provider_type": "oci_email_delivery"}])
        operation = MailAdminOperations(db=FakeDb(cursor))
        with patch.object(operation.policy, "save_domain_contract") as save, patch.object(operation, "get_overview", return_value={}):
            operation.update_domain(
                actor(), MailOperationsDomainUpdateRequest(
                    registeredDomain="sinsan.kr", mailDomain="moaworks.sinsan.kr",
                    adminAccessMode="private", adminAllowedCidrs=[],
                ),
            )
        self.assertEqual(save.call_args.kwargs["active_provider"], "oci_email_delivery")

    def test_domain_update_and_provider_switch_preserve_transaction_contract(self) -> None:
        domain_cursor = RecordingCursor(one_rows=[{"active_outbound_provider_key": "self_hosted"}])
        operation = MailAdminOperations(db=FakeDb(domain_cursor))
        with patch.object(operation.policy, "save_domain_contract") as save, patch.object(operation, "get_overview", return_value={"ok": True}):
            result = operation.update_domain(
                actor(),
                MailOperationsDomainUpdateRequest(
                    registeredDomain="sinsan.kr", mailDomain="moaworks.sinsan.kr",
                    adminAccessMode="restricted", adminAllowedCidrs=["203.0.113.0/24"],
                ),
            )
        self.assertEqual(result, {"ok": True})
        self.assertEqual(save.call_args.kwargs["contract"].admin_allowed_cidrs, ("203.0.113.0/24",))

        switch_cursor = RecordingCursor(one_rows=[{"active_outbound_provider_key": "self_hosted"}])
        operation = MailAdminOperations(db=FakeDb(switch_cursor))
        plan = ProviderSwitchPlan("self_hosted", "oci_email_delivery", {"queue-1": "self_hosted"})
        with patch.object(operation.policy, "switch_outbound_provider", return_value=plan):
            switched = operation.switch_provider(actor(), "oci_email_delivery")
        self.assertEqual(switched["activeProvider"], "oci_email_delivery")
        self.assertEqual(switched["pinnedQueueCount"], 1)

    def test_rollback_and_oci_sync_are_admin_audited_operations(self) -> None:
        operation = MailAdminOperations(db=FakeDb(RecordingCursor()))
        plan = ProviderSwitchPlan("oci_email_delivery", "self_hosted", {})
        with patch.object(operation.policy, "rollback_outbound_provider", return_value=plan):
            rolled_back = operation.rollback_provider(actor())
        self.assertEqual(rolled_back["activeProvider"], "self_hosted")

        sync_cursor = RecordingCursor(one_rows=[{"mail_domain": "moaworks.sinsan.kr"}])
        oci = SimpleNamespace(sync=lambda **_kwargs: {"suppressionCount": 2})
        result = MailAdminOperations(db=FakeDb(sync_cursor), oci_operations=oci).sync_oci_suppressions(actor())
        self.assertEqual(result["suppressionCount"], 2)

    def test_non_active_provider_can_run_real_delivery_test_before_switch(self) -> None:
        provider = {
            "id": "provider-oci", "provider_type": "oci_email_delivery", "relay_host": "smtp.oci.example",
            "relay_port": 587, "tls_mode": "starttls", "from_address": "postmaster@moaworks.sinsan.kr",
            "username": "smtp-user", "encrypted_password": "cipher", "active": False,
            "delivery_enabled": False, "last_test_status": "untested", "encrypted_dkim_private_key": None,
        }
        updated = {
            **provider,
            "delivery_enabled": True,
            "last_test_status": "success",
            "last_connection_at": None,
            "last_connection_error": None,
        }
        cursor = RecordingCursor(one_rows=[provider, {"mail_domain": "moaworks.sinsan.kr", "mail_host": "mail.moaworks.sinsan.kr"}, updated])

        class Adapter:
            def __init__(self) -> None:
                self.calls = []

            def send(self, envelope, config):
                self.calls.append((envelope, config))
                return "provider=oci_email_delivery;endpoint=smtps://smtp.oci.example:587;accepted=true"

        adapter = Adapter()
        operation = MailAdminOperations(db=FakeDb(cursor), delivery_adapter=adapter)
        with patch.object(operation.security, "decrypt_secret", return_value="smtp-password"):
            result = operation.test_provider(actor(), "oci_email_delivery", "external@example.net")
        self.assertEqual(result["lastTestStatus"], "success")
        self.assertTrue(result["deliveryEnabled"])
        self.assertEqual(adapter.calls[0][0]["recipient_email"], "external@example.net")
        self.assertEqual(adapter.calls[0][1]["password"], "smtp-password")
        self.assertNotIn("smtp-password", str(result))

    def test_api_routes_use_authenticated_admin_and_map_validation_errors(self) -> None:
        client = TestClient(app)
        admin = actor()
        app.dependency_overrides[require_admin] = lambda: admin
        service = SimpleNamespace(
            get_overview=lambda _actor: {"ok": True},
            update_domain=lambda _actor, _payload: {"updated": True},
            update_provider=lambda _actor, key, _payload: {"providerKey": key},
            switch_provider=lambda _actor, key: {"activeProvider": key},
            rollback_provider=lambda _actor: {"activeProvider": "self_hosted"},
            test_provider=lambda _actor, key, recipient: {"providerKey": key, "recipient": recipient},
            sync_oci_suppressions=lambda _actor: {"suppressionCount": 0},
        )
        try:
            with patch("app.api.routes.mail_operations_admin._service", return_value=service):
                self.assertEqual(client.get("/api/v1/admin/mail-operations").status_code, 200)
                domain_payload = {"registeredDomain": "sinsan.kr", "mailDomain": "moaworks.sinsan.kr", "adminAccessMode": "restricted", "adminAllowedCidrs": ["203.0.113.0/24"]}
                self.assertEqual(client.put("/api/v1/admin/mail-operations/domain", json=domain_payload).status_code, 200)
                self.assertEqual(client.put("/api/v1/admin/mail-operations/providers/self_hosted", json={}).status_code, 200)
                self.assertEqual(client.post("/api/v1/admin/mail-operations/providers/switch", json={"targetProvider": "oci_email_delivery"}).status_code, 200)
                self.assertEqual(client.post("/api/v1/admin/mail-operations/providers/oci_email_delivery/test", json={"recipient": "external@example.net"}).status_code, 200)
                self.assertEqual(client.post("/api/v1/admin/mail-operations/providers/rollback").status_code, 200)
                self.assertEqual(client.post("/api/v1/admin/mail-operations/oci/suppressions/sync").status_code, 200)
            failing = SimpleNamespace(get_overview=lambda _actor: (_ for _ in ()).throw(ValueError("invalid")))
            with patch("app.api.routes.mail_operations_admin._service", return_value=failing):
                self.assertEqual(client.get("/api/v1/admin/mail-operations").status_code, 400)
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
