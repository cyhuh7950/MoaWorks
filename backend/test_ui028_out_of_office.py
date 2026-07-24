from __future__ import annotations

import unittest
import json
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.mail import _handle_error, update_out_of_office_settings
from app.schemas.mail_messenger import MailOutOfOfficePolicyUpdateRequest
from app.services.mail_out_of_office_service import (
    MailOutOfOfficePolicyConflictError,
    MailOutOfOfficeService,
    OutOfOfficeInvalidPeriodError,
    OutOfOfficeRequiredContentError,
    OutOfOfficeTargetForbiddenError,
    classify_out_of_office_sender,
    compute_out_of_office_state,
    normalize_out_of_office_email,
    should_suppress_out_of_office,
)
from app.services.mail_delivery_service import SmtpRelayAdapter


class Ui028MigrationTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_has_policy_delivery_extensions_and_guards(self):
        sql = (self.root / "migrations" / "032_mail_out_of_office.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists mail_out_of_office_policies",
            "create table if not exists mail_out_of_office_deliveries",
            "unique (company_id, user_id)",
            "unique (policy_id, period_start, period_end, normalized_sender_email)",
            "check (target_scope in ('all','internal','external'))",
            "add column if not exists is_auto_generated",
            "check (delivery_source in ('direct','auto_forward','out_of_office'))",
            "check (delivery_kind in ('direct','auto_forward','out_of_office'))",
            "idx_mail_out_of_office_deliveries_owner_created",
        ):
            self.assertIn(marker, sql)


class Ui028SchemaAndPureDecisionTests(unittest.TestCase):
    def test_policy_schema_only_rejects_structural_invalid_values(self):
        valid = MailOutOfOfficePolicyUpdateRequest(
            enabled=True, startDate=date(2026, 7, 24), endDate=date(2026, 7, 24),
            subject="S", message="M", targetScope="all", version=1,
        )
        self.assertEqual(valid.targetScope, "all")
        semantic_values = (
            dict(enabled=True, startDate=date(2026, 7, 25), endDate=date(2026, 7, 24), subject="S", message="M", targetScope="all", version=1),
            dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2027, 7, 25), subject="S", message="M", targetScope="all", version=1),
            dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2026, 7, 24), subject="", message="M", targetScope="all", version=1),
            dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2026, 7, 24), subject="S", message="", targetScope="all", version=1),
        )
        for payload in semantic_values:
            with self.subTest(payload=payload):
                self.assertIsInstance(MailOutOfOfficePolicyUpdateRequest(**payload), MailOutOfOfficePolicyUpdateRequest)
        structural_values = (
            dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2026, 7, 24), subject="S", message="M", targetScope="other", version=1),
            dict(enabled=False, startDate=None, endDate=None, subject="", message="", targetScope="all", version=0),
        )
        for payload in structural_values:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                MailOutOfOfficePolicyUpdateRequest(**payload)

    def test_route_maps_semantic_policy_errors_to_stable_400_codes(self):
        cases = (
            (dict(enabled=True, startDate=date(2026, 7, 25), endDate=date(2026, 7, 24), subject="S", message="M", targetScope="all", version=1), "MAIL_OUT_OF_OFFICE_INVALID_PERIOD"),
            (dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2027, 7, 25), subject="S", message="M", targetScope="all", version=1), "MAIL_OUT_OF_OFFICE_INVALID_PERIOD"),
            (dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2026, 7, 24), subject="", message="M", targetScope="all", version=1), "MAIL_OUT_OF_OFFICE_REQUIRED_CONTENT"),
            (dict(enabled=True, startDate=date(2026, 7, 24), endDate=date(2026, 7, 24), subject="S", message="", targetScope="all", version=1), "MAIL_OUT_OF_OFFICE_REQUIRED_CONTENT"),
        )
        service = MailOutOfOfficeService(db=Mock())
        actor = SimpleNamespace(companyId="company-1", userId="owner-user", userName="Owner")
        with patch("app.api.routes.mail._out_of_office_service", return_value=service):
            for values, code in cases:
                with self.subTest(code=code), self.assertRaises(HTTPException) as captured:
                    update_out_of_office_settings(MailOutOfOfficePolicyUpdateRequest(**values), actor)
                self.assertEqual(captured.exception.status_code, 400)
                self.assertEqual(captured.exception.detail["code"], code)

    def test_route_rejects_partial_or_reversed_period_while_disabled(self):
        cases = (
            dict(enabled=False, startDate=date(2026, 7, 24), endDate=None, subject="", message="", targetScope="all", version=1),
            dict(enabled=False, startDate=None, endDate=date(2026, 7, 24), subject="", message="", targetScope="all", version=1),
            dict(enabled=False, startDate=date(2026, 7, 25), endDate=date(2026, 7, 24), subject="", message="", targetScope="all", version=1),
        )
        service = MailOutOfOfficeService(db=Mock())
        actor = SimpleNamespace(companyId="company-1", userId="owner-user", userName="Owner")
        with patch("app.api.routes.mail._out_of_office_service", return_value=service):
            for values in cases:
                with self.subTest(values=values), self.assertRaises(HTTPException) as captured:
                    update_out_of_office_settings(MailOutOfOfficePolicyUpdateRequest(**values), actor)
                self.assertEqual(captured.exception.status_code, 400)
                self.assertEqual(captured.exception.detail["code"], "MAIL_OUT_OF_OFFICE_INVALID_PERIOD")

    def test_state_uses_inclusive_seoul_dates(self):
        self.assertEqual(compute_out_of_office_state(False, date(2026, 7, 24), date(2026, 7, 25), date(2026, 7, 24)), "disabled")
        self.assertEqual(compute_out_of_office_state(True, date(2026, 7, 25), date(2026, 7, 26), date(2026, 7, 24)), "scheduled")
        self.assertEqual(compute_out_of_office_state(True, date(2026, 7, 24), date(2026, 7, 25), date(2026, 7, 24)), "active")
        self.assertEqual(compute_out_of_office_state(True, date(2026, 7, 23), date(2026, 7, 23), date(2026, 7, 24)), "expired")

    def test_sender_normalization_scope_and_suppression(self):
        self.assertEqual(normalize_out_of_office_email(" User@예시.한국 "), "user@xn--vv4b11d.xn--3e0b707e")
        active = {"inside@example.com": "inside-user"}
        self.assertEqual(classify_out_of_office_sender("inside@example.com", active, "example.com"), ("internal", "inside-user"))
        self.assertEqual(classify_out_of_office_sender("outside@other.test", active, "example.com"), ("external", None))
        self.assertEqual(classify_out_of_office_sender("missing@example.com", active, "example.com"), ("suppressed", None))
        for sender in ("owner@example.com", "mailer-daemon@example.com", "no-reply@other.test", "noreply@other.test"):
            with self.subTest(sender=sender):
                self.assertTrue(should_suppress_out_of_office(sender, "owner@example.com", False))
        self.assertTrue(should_suppress_out_of_office("sender@other.test", "owner@example.com", True))
        self.assertFalse(should_suppress_out_of_office("sender@other.test", "owner@example.com", False))

    def test_safe_error_mapping_is_stable(self):
        cases = (
            (MailOutOfOfficePolicyConflictError("conflict"), 409, "MAIL_OUT_OF_OFFICE_POLICY_CONFLICT"),
            (OutOfOfficeInvalidPeriodError("period"), 400, "MAIL_OUT_OF_OFFICE_INVALID_PERIOD"),
            (OutOfOfficeRequiredContentError("content"), 400, "MAIL_OUT_OF_OFFICE_REQUIRED_CONTENT"),
            (OutOfOfficeTargetForbiddenError("forbidden"), 403, "MAIL_OUT_OF_OFFICE_FORBIDDEN"),
        )
        for error, status, code in cases:
            with self.subTest(code=code), self.assertRaises(HTTPException) as captured:
                _handle_error(error)
            self.assertEqual(captured.exception.status_code, status)
            self.assertEqual(captured.exception.detail["code"], code)


class Ui028PipelineSecurityAndRouteTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_immediate_and_scheduled_paths_preserve_order_and_direct_gate(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        save = source[source.index("    def _save_mail("):source.index("    def _evaluate_recipient_spam(")]
        dispatch = source[source.index("    def dispatch_scheduled_mail"):source.index("    def mark_mail_read")]
        for section in (save, dispatch):
            self.assertLess(section.index("_evaluate_recipient_spam"), section.index("_apply_auto_classification"))
            self.assertLess(section.index("_apply_auto_classification"), section.index("_apply_auto_forwarding"))
            self.assertLess(section.index("_apply_auto_forwarding"), section.index("_apply_out_of_office"))
            self.assertIn('delivery_source="direct"', section)

    def test_out_of_office_service_is_savepoint_scoped_parameterized_and_metadata_only(self):
        source = (self.root / "app" / "services" / "mail_out_of_office_service.py").read_text(encoding="utf-8").lower()
        self.assertIn("savepoint out_of_office", source)
        self.assertIn("for update", source)
        self.assertIn("on conflict(policy_id,period_start,period_end,normalized_sender_email) do nothing", source)
        self.assertIn("isinstance(evaluator_error, psycopgerror)", source)
        self.assertNotIn('f"select', source)
        self.assertNotIn('f"insert', source)
        audit = source[source.index("def _audit") :]
        for forbidden in ("subject", "message_text", "normalized_sender_email", "recipient_email"):
            self.assertNotIn(forbidden, audit)

    def test_response_mail_is_plain_auto_generated_hidden_and_worker_syncs_status(self):
        service = (self.root / "app" / "services" / "mail_out_of_office_service.py").read_text(encoding="utf-8").lower()
        for marker in ("'out_of_office'", "is_auto_generated", "sender_copy_saved", "read_receipt_requested", "body_html"):
            self.assertIn(marker, service)
        worker = (self.root / "app" / "services" / "mail_delivery_operations.py").read_text(encoding="utf-8")
        self.assertIn("mail_out_of_office_deliveries", worker)

    def test_out_of_office_smtp_uses_owner_from_and_envelope_without_html(self):
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.send_message.return_value = {}
        envelope = {
            "delivery_kind": "out_of_office", "sender_email": "owner@example.com", "sender_display_name": "",
            "reply_to_email": None, "recipient_email": "sender@outside.test", "subject": "Away",
            "body_text": "Plain response", "body_html": None, "message_encoding": "utf-8",
        }
        provider = {"relay_host": "relay", "relay_port": 25, "tls_mode": "plain", "from_address": "provider@example.net"}
        with patch("app.services.mail_delivery_service.smtplib.SMTP", return_value=client):
            SmtpRelayAdapter().send(envelope, provider)
        message = client.send_message.call_args.args[0]
        self.assertEqual(message["From"], "owner@example.com")
        self.assertEqual(client.send_message.call_args.kwargs["from_addr"], "owner@example.com")
        self.assertEqual(client.send_message.call_args.kwargs["to_addrs"], ["sender@outside.test"])
        self.assertFalse(message.is_multipart())

    def test_get_patch_routes_use_split_permissions_before_dynamic_route(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        get_marker = '@router.get("/settings/out-of-office"'
        patch_marker = '@router.patch("/settings/out-of-office"'
        self.assertIn(get_marker, source)
        self.assertIn(patch_marker, source)
        self.assertLess(source.index(get_marker), source.index('@router.get("/{mail_id}"'))
        section = source[source.index(get_marker):source.index('@router.get("/settings/auto-forwarding"')]
        self.assertEqual(section.count('permission_required("mail:read")'), 1)
        self.assertEqual(section.count('permission_required("mail:send")'), 1)


class _ScriptedOutOfOfficeCursor:
    def __init__(self, *, sender_is_internal: bool = False, duplicate: bool = False, provider_locked: bool = True):
        self.sender_is_internal = sender_is_internal
        self.duplicate = duplicate
        self.provider_locked = provider_locked
        self.executions: list[tuple[str, tuple]] = []
        self._one = None
        self._all = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executions.append((normalized, tuple(params)))
        lowered = normalized.lower()
        self._one = None
        self._all = []
        if lowered.startswith("select p.id,p.enabled"):
            self._one = {
                "id": "policy-1", "enabled": True, "start_date": date(2026, 7, 24),
                "end_date": date(2026, 7, 24), "subject": "Away", "message_text": "Response",
                "target_scope": "all",
            }
        elif lowered.startswith("select a.id,a.email"):
            self._one = {
                "id": "account-1", "email": "owner@example.com", "provider_config_id": "provider-1",
                "delivery_enabled": not self.provider_locked, "last_test_status": "success",
            }
        elif lowered.startswith("select domain from companies"):
            self._one = {"domain": "example.com"}
        elif lowered.startswith("select id,lower(email)"):
            self._all = [{"id": "owner-user", "email": "owner@example.com"}]
            if self.sender_is_internal:
                self._all.append({"id": "sender-user", "email": "sender@example.com"})
        elif lowered.startswith("insert into mail_out_of_office_deliveries"):
            self._one = None if self.duplicate else {"id": "delivery-1"}

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


class Ui028RecipientBehaviorTests(unittest.TestCase):
    now = datetime(2026, 7, 24, 3, tzinfo=UTC)

    def _apply(self, cursor, sender_email):
        return MailOutOfOfficeService(db=Mock()).apply_recipient(
            cursor, company_id="company-1", user_id="owner-user",
            actor_user_id="origin-sender-id", actor_user_name="Origin Sender",
            mail_id="origin-mail", recipient_id="origin-recipient", sender_email=sender_email,
            delivery_source="direct", is_auto_generated=False, is_spam=False, now=self.now,
        )

    @staticmethod
    def _matching(cursor, prefix):
        return [(sql, params) for sql, params in cursor.executions if sql.lower().startswith(prefix)]

    def test_duplicate_sender_creates_no_response_queue_or_audit(self):
        cursor = _ScriptedOutOfOfficeCursor(duplicate=True)
        self.assertEqual(self._apply(cursor, "sender@outside.test"), "duplicate")
        for prefix in ("insert into mail_messages", "insert into mail_recipients", "insert into mail_delivery_queue", "insert into audit_logs"):
            self.assertEqual(self._matching(cursor, prefix), [])

    def test_internal_sender_creates_internal_response_without_queue(self):
        cursor = _ScriptedOutOfOfficeCursor(sender_is_internal=True)
        self.assertEqual(self._apply(cursor, "sender@example.com"), "internal_delivered")
        mail = self._matching(cursor, "insert into mail_messages")
        recipient = self._matching(cursor, "insert into mail_recipients")
        self.assertEqual(len(mail), 1)
        self.assertIn("is_auto_generated", mail[0][0].lower())
        self.assertEqual(recipient[0][1][2], "sender-user")
        self.assertEqual(self._matching(cursor, "insert into mail_delivery_queue"), [])

    def test_external_sender_with_locked_provider_creates_blocked_queue(self):
        cursor = _ScriptedOutOfOfficeCursor(provider_locked=True)
        self.assertEqual(self._apply(cursor, "sender@outside.test"), "blocked")
        queue = self._matching(cursor, "insert into mail_delivery_queue")
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0][1][5], "blocked")
        self.assertIn("'out_of_office'", queue[0][0].lower())

    def test_apply_audit_uses_policy_owner_and_metadata_only(self):
        cursor = _ScriptedOutOfOfficeCursor(sender_is_internal=True)
        self.assertEqual(self._apply(cursor, "sender@example.com"), "internal_delivered")
        audit = self._matching(cursor, "insert into audit_logs")
        self.assertEqual(len(audit), 1)
        params = audit[0][1]
        self.assertEqual(params[2], "owner-user")
        self.assertEqual(params[3], "system")
        self.assertNotEqual(params[2], "origin-sender-id")
        self.assertEqual(set(json.loads(params[6])), {"targetKind", "status"})


if __name__ == "__main__":
    unittest.main()
