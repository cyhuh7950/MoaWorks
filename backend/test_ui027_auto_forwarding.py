from __future__ import annotations

import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.mail import _handle_error
from app.schemas.mail_messenger import (
    MailAutoForwardExceptionCreateRequest,
    MailAutoForwardExceptionUpdateRequest,
    MailAutoForwardExceptionsDeleteRequest,
    MailAutoForwardPolicyUpdateRequest,
    MailAutoForwardTargetsCreateRequest,
    MailAutoForwardTargetsDeleteRequest,
)
from app.services.mail_auto_forwarding_service import (
    AutoForwardConflictError,
    AutoForwardDecision,
    AutoForwardInvalidInternalTargetError,
    AutoForwardLimitError,
    AutoForwardSelfTargetError,
    AutoForwardTargetForbiddenError,
    MailAutoForwardingService,
    normalize_forward_domain,
    normalize_forward_email,
)
from app.services.mail_messenger_service import MailMessengerService
from app.services.mail_delivery_service import SmtpRelayAdapter


class Ui027MigrationAndNormalizationTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_has_tables_extensions_constraints_and_indexes(self):
        sql = (self.root / "migrations" / "031_mail_auto_forwarding.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists mail_auto_forward_policies",
            "create table if not exists mail_auto_forward_targets",
            "create table if not exists mail_auto_forward_exceptions",
            "create table if not exists mail_auto_forward_exception_targets",
            "create table if not exists mail_auto_forward_deliveries",
            "add column if not exists delivery_source",
            "add column if not exists auto_forward_owner_user_id",
            "add column if not exists auto_forward_origin_recipient_id",
            "add column if not exists delivery_kind",
            "add column if not exists sender_email_override",
            "add column if not exists sender_display_name_override",
            "add column if not exists reply_to_email_override",
            "unique (company_id, user_id)",
            "unique (origin_recipient_id, target_email)",
            "check (delivery_source in ('direct','auto_forward'))",
            "check (delivery_kind in ('direct','auto_forward'))",
            "idx_mail_auto_forward_deliveries_owner_created",
        ):
            self.assertIn(marker, sql)

    def test_email_and_domain_normalization_are_idna_and_case_safe(self):
        self.assertEqual(normalize_forward_email(" User@예시.한국 "), "user@xn--vv4b11d.xn--3e0b707e")
        self.assertEqual(normalize_forward_domain(" @예시.한국 "), "xn--vv4b11d.xn--3e0b707e")
        for value in ("missing-at", "a@@example.com", "a@", "@example.com"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_forward_email(value)


class Ui027SchemaAndDecisionTests(unittest.TestCase):
    def test_schema_enforces_limits_versions_and_override_targets(self):
        targets = MailAutoForwardTargetsCreateRequest(emails=["A@example.com", "a@example.com", "b@example.com"])
        self.assertEqual(targets.emails, ["a@example.com", "b@example.com"])
        with self.assertRaises(ValidationError):
            MailAutoForwardTargetsCreateRequest(emails=[])
        with self.assertRaises(ValidationError):
            MailAutoForwardTargetsCreateRequest(emails=[f"u{i}@example.com" for i in range(11)])
        with self.assertRaises(ValidationError):
            MailAutoForwardPolicyUpdateRequest(enabled=True, keepOriginal=True, version=0)
        with self.assertRaises(ValidationError):
            MailAutoForwardTargetsDeleteRequest(targetIds=[])
        with self.assertRaises(ValidationError):
            MailAutoForwardExceptionsDeleteRequest(exceptionIds=[])
        with self.assertRaises(ValidationError):
            MailAutoForwardExceptionCreateRequest(matcherType="sender_email", matcherValue="a@example.com", action="override", targetEmails=[])
        with self.assertRaises(ValidationError):
            MailAutoForwardExceptionUpdateRequest(matcherType="sender_domain", matcherValue="example.com", action="skip", targetEmails=["x@outside.test"], enabled=True, version=1)

    def test_exact_email_precedes_longest_domain_and_disabled_is_ignored(self):
        rules = [
            {"id": "broad", "matcher_type": "sender_domain", "matcher_value": "example.com", "action": "override", "enabled": True, "target_emails": ["broad@outside.test"]},
            {"id": "narrow", "matcher_type": "sender_domain", "matcher_value": "mail.example.com", "action": "override", "enabled": True, "target_emails": ["narrow@outside.test"]},
            {"id": "disabled", "matcher_type": "sender_email", "matcher_value": "vip@mail.example.com", "action": "skip", "enabled": False, "target_emails": []},
            {"id": "exact", "matcher_type": "sender_email", "matcher_value": "vip@mail.example.com", "action": "override", "enabled": True, "target_emails": ["exact@outside.test"]},
        ]
        decision = AutoForwardDecision.from_rules(["default@outside.test"], rules, "VIP@mail.example.com")
        self.assertEqual(decision.exceptionId, "exact")
        self.assertEqual(decision.targetEmails, ["exact@outside.test"])
        decision = AutoForwardDecision.from_rules(["default@outside.test"], rules, "other@mail.example.com")
        self.assertEqual(decision.exceptionId, "narrow")
        self.assertEqual(decision.targetEmails, ["narrow@outside.test"])

    def test_skip_and_case_insensitive_target_deduplication(self):
        skip = [{"id": "skip", "matcher_type": "sender_domain", "matcher_value": "example.com", "action": "skip", "enabled": True, "target_emails": []}]
        decision = AutoForwardDecision.from_rules(["A@outside.test", "a@outside.test"], skip, "sender@example.com")
        self.assertEqual(decision.targetEmails, [])
        self.assertEqual(decision.exceptionId, "skip")

    def test_safe_error_codes_are_distinct(self):
        cases = (
            (AutoForwardConflictError("conflict"), 409, "MAIL_AUTO_FORWARD_EXCEPTION_CONFLICT"),
            (AutoForwardLimitError("limit"), 409, "MAIL_AUTO_FORWARD_LIMIT_EXCEEDED"),
            (AutoForwardSelfTargetError("self"), 400, "MAIL_AUTO_FORWARD_SELF_TARGET"),
            (AutoForwardInvalidInternalTargetError("internal"), 400, "MAIL_AUTO_FORWARD_INVALID_INTERNAL_TARGET"),
            (AutoForwardTargetForbiddenError("forbidden"), 403, "MAIL_AUTO_FORWARD_TARGET_FORBIDDEN"),
        )
        for error, status, code in cases:
            with self.subTest(code=code), self.assertRaises(HTTPException) as captured:
                _handle_error(error)
            self.assertEqual(captured.exception.status_code, status)
            self.assertEqual(captured.exception.detail["code"], code)


class Ui027PipelineAndPrivacyTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_receive_paths_apply_after_spam_and_classification_and_direct_only(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        save = source[source.index("    def _save_mail("):source.index("    def _evaluate_recipient_spam(")]
        self.assertLess(save.index("_evaluate_recipient_spam"), save.index("_apply_auto_classification"))
        self.assertLess(save.index("_apply_auto_classification"), save.index("_apply_auto_forwarding"))
        self.assertIn('delivery_source="direct"', save)
        dispatch = source[source.index("    def dispatch_scheduled_mail"):source.index("    def mark_mail_read")]
        self.assertIn("received_at IS NULL", dispatch)
        self.assertLess(dispatch.index("_apply_auto_classification"), dispatch.index("_apply_auto_forwarding"))
        self.assertIn("delivery_source = 'direct'", dispatch)

    def test_auto_forward_recipients_are_hidden_from_sender_and_recent_views(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        recent = source[source.index("    def list_recent_recipients"):source.index("    def download_attachment")]
        recipient_view = source[source.index("    def _fetch_mail_recipients"):source.index("    def _fetch_source_attachments")]
        external = source[source.index("    def _fetch_external_deliveries"):source.index("    def _fetch_mail_attachments")]
        for section in (recent, recipient_view, external):
            self.assertIn("delivery_source = 'direct'", section)

    def test_wrapper_never_reenters_for_auto_forward_source(self):
        service = MailMessengerService()
        service.auto_forwarding = Mock()
        cursor = Mock()
        service._apply_auto_forwarding(
            cursor, company_id="company-a", recipient_user_id="user-a", actor_user_id="sender-a",
            actor_user_name="sender", mail_id="mail-a", recipient_id="recipient-a",
            sender_email="sender@example.com", recipient_email="user@example.com", delivery_source="auto_forward",
            now=datetime(2026, 7, 24, tzinfo=UTC),
        )
        service.auto_forwarding.apply_recipient.assert_not_called()


class Ui027ExternalDeliveryAndRetentionTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_worker_uses_overrides_only_for_auto_forward_queue(self):
        source = (self.root / "app" / "services" / "mail_delivery_operations.py").read_text(encoding="utf-8")
        claim = source[source.index("    def claim_next"):source.index("    def finalize_claim")]
        self.assertIn("q.delivery_kind", claim)
        self.assertIn("sender_email_override", claim)
        self.assertIn("reply_to_email_override", claim)
        worker_source = (self.root / "app" / "services" / "mail_delivery_service.py").read_text(encoding="utf-8")
        self.assertIn('_job_value(job, "delivery_kind") == "auto_forward"', worker_source)

    def test_finalize_updates_forward_delivery_and_only_hides_origin_after_all_success(self):
        source = (self.root / "app" / "services" / "mail_delivery_operations.py").read_text(encoding="utf-8")
        finalize = source[source.index("    def finalize_claim"):source.index("    def run_once")]
        self.assertIn("mail_auto_forward_deliveries", finalize)
        self.assertIn("reconcile_original_retention", finalize)

    def test_service_uses_savepoint_origin_lock_and_no_sensitive_audit_content(self):
        source = (self.root / "app" / "services" / "mail_auto_forwarding_service.py").read_text(encoding="utf-8").lower()
        self.assertIn("savepoint auto_forwarding", source)
        self.assertIn("pg_advisory_xact_lock", source)
        self.assertIn("origin_recipient_id", source)
        self.assertIn("select target_email from mail_auto_forward_deliveries", source)
        self.assertIn("isinstance(evaluator_error, psycopgerror)", source)
        audit = source[source.index("def _audit"):]
        for forbidden in ("subject", "body_text", "attachment", "recipient_emails"):
            self.assertNotIn(forbidden, audit)
        self.assertNotIn('f"select', source)
        self.assertNotIn('f"insert', source)


class Ui027RouteTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_routes_are_before_dynamic_route_and_permissions_are_split(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        markers = (
            '@router.get("/settings/auto-forwarding"',
            '@router.patch("/settings/auto-forwarding"',
            '@router.post("/settings/auto-forwarding/targets"',
            '@router.post("/settings/auto-forwarding/targets/delete"',
            '@router.post("/settings/auto-forwarding/exceptions"',
            '@router.post("/settings/auto-forwarding/exceptions/delete"',
            '@router.patch("/settings/auto-forwarding/exceptions/{exception_id}"',
            '@router.delete("/settings/auto-forwarding/exceptions/{exception_id}"',
        )
        for marker in markers:
            self.assertIn(marker, source)
        self.assertLess(source.index(markers[0]), source.index('@router.get("/{mail_id}"'))
        section = source[source.index(markers[0]):source.index('@router.post("/{mail_id}/category"')]
        self.assertEqual(section.count('permission_required("mail:read")'), 1)
        self.assertEqual(section.count('permission_required("mail:send")'), 7)


class DuplicateDirectRecipientCursor:
    def __init__(self, *, direct_emails: list[str]):
        self.direct_emails = direct_emails
        self.executions: list[tuple[str, tuple]] = []
        self.next_one = None
        self.next_all: list[dict] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executions.append((normalized, tuple(params)))
        upper = normalized.upper()
        self.next_one = None
        self.next_all = []
        if upper.startswith("SELECT ENABLED,KEEP_ORIGINAL FROM MAIL_AUTO_FORWARD_POLICIES"):
            self.next_one = {"enabled": True, "keep_original": False}
        elif upper.startswith("SELECT NORMALIZED_EMAIL,TARGET_USER_ID,TARGET_KIND FROM MAIL_AUTO_FORWARD_TARGETS"):
            self.next_all = [
                {"normalized_email": "existing@example.net", "target_user_id": None, "target_kind": "external"},
                {"normalized_email": "new@example.net", "target_user_id": None, "target_kind": "external"},
            ]
        elif upper.startswith("SELECT ID,MATCHER_TYPE,MATCHER_VALUE,ACTION,ENABLED FROM MAIL_AUTO_FORWARD_EXCEPTIONS"):
            self.next_all = []
        elif upper.startswith("SELECT TARGET_EMAIL FROM MAIL_AUTO_FORWARD_DELIVERIES"):
            self.next_all = []
        elif "FROM MAIL_RECIPIENTS" in upper and "DELIVERY_SOURCE='DIRECT'" in upper:
            self.next_all = [{"recipient_email": email} for email in self.direct_emails]
        elif upper.startswith("SELECT A.ID,A.EMAIL,A.PROVIDER_CONFIG_ID"):
            self.next_one = {"id": "account-a", "email": "owner@example.com", "provider_config_id": "provider-a", "delivery_enabled": False, "last_test_status": "success"}

    def fetchone(self):
        value, self.next_one = self.next_one, None
        return value

    def fetchall(self):
        values, self.next_all = self.next_all, []
        return values


class Ui027FirstReviewRemediationTests(unittest.TestCase):
    def test_immediate_receive_skips_existing_direct_recipient_and_forwards_only_new_target(self):
        cursor = DuplicateDirectRecipientCursor(direct_emails=["existing@example.net"])
        decision = MailAutoForwardingService().apply_recipient(
            cursor, company_id="company-a", user_id="owner-a", actor_user_id="sender-a", actor_user_name="sender",
            mail_id="mail-a", recipient_id="origin-a", sender_email="sender@example.com", now=datetime(2026, 7, 24, tzinfo=UTC),
        )
        inserted = [params for sql, params in cursor.executions if sql.upper().startswith("INSERT INTO MAIL_RECIPIENTS")]
        self.assertEqual(decision.targetEmails, ["new@example.net"])
        self.assertEqual([params[3] for params in inserted], ["new@example.net"])

    def test_scheduled_receive_all_direct_duplicates_keeps_origin_and_creates_nothing(self):
        cursor = DuplicateDirectRecipientCursor(direct_emails=["existing@example.net", "new@example.net"])
        decision = MailAutoForwardingService().apply_recipient(
            cursor, company_id="company-a", user_id="owner-a", actor_user_id="sender-a", actor_user_name="system",
            mail_id="scheduled-mail", recipient_id="scheduled-origin", sender_email="sender@example.com", now=datetime(2026, 7, 24, tzinfo=UTC),
        )
        sql = "\n".join(statement for statement, _ in cursor.executions).upper()
        self.assertEqual(decision.targetEmails, [])
        self.assertNotIn("INSERT INTO MAIL_RECIPIENTS", sql)
        self.assertNotIn("INSERT INTO MAIL_AUTO_FORWARD_DELIVERIES", sql)
        self.assertNotIn("UPDATE MAIL_RECIPIENTS ORIGIN SET DELETED_AT", sql)

    def test_auto_forward_smtp_uses_owner_as_envelope_sender_and_origin_as_reply_to(self):
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.send_message.return_value = {}
        envelope = {
            "delivery_kind": "auto_forward", "sender_email": "owner@example.com", "sender_display_name": "Owner",
            "reply_to_email": "origin@example.org", "recipient_email": "target@example.net", "subject": "subject",
            "body_text": "body", "body_html": None, "message_encoding": "utf-8",
        }
        provider = {"relay_host": "relay", "relay_port": 25, "tls_mode": "plain", "from_address": "provider@example.net"}
        with patch("app.services.mail_delivery_service.smtplib.SMTP", return_value=client):
            SmtpRelayAdapter().send(envelope, provider)
        message = client.send_message.call_args.args[0]
        self.assertEqual(client.send_message.call_args.kwargs["from_addr"], "owner@example.com")
        self.assertEqual(client.send_message.call_args.kwargs["to_addrs"], ["target@example.net"])
        self.assertEqual(message["Reply-To"], "origin@example.org")

    def test_direct_smtp_keeps_existing_provider_from_and_implicit_envelope(self):
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.send_message.return_value = {}
        envelope = {
            "delivery_kind": "direct", "sender_email": "sender@example.com", "sender_display_name": "Sender",
            "reply_to_email": None, "recipient_email": "target@example.net", "subject": "subject",
            "body_text": "body", "body_html": None, "message_encoding": "utf-8",
        }
        provider = {"relay_host": "relay", "relay_port": 25, "tls_mode": "plain", "from_address": "provider@example.net"}
        with patch("app.services.mail_delivery_service.smtplib.SMTP", return_value=client):
            SmtpRelayAdapter().send(envelope, provider)
        message = client.send_message.call_args.args[0]
        self.assertEqual(message["From"], "Sender <provider@example.net>")
        self.assertEqual(client.send_message.call_args.kwargs, {})


class Ui027SecondOperationsReviewRemediationTests(unittest.TestCase):
    def setUp(self):
        self.actor = SimpleNamespace(companyId="company-a", userId="user-a")
        self.cursor = Mock()
        self.cursor.fetchone.return_value = None

    def test_create_matcher_uniqueness_omits_exclude_clause_and_parameter(self):
        MailAutoForwardingService._assert_matcher_unique(
            self.cursor, self.actor, "sender_email", "sender@example.com",
        )

        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(
            sql,
            "SELECT id FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s AND matcher_type=%s AND matcher_value=%s",
        )
        self.assertEqual(params, ("company-a", "user-a", "sender_email", "sender@example.com"))

    def test_update_matcher_uniqueness_binds_explicit_exclude_id(self):
        MailAutoForwardingService._assert_matcher_unique(
            self.cursor, self.actor, "sender_domain", "example.com", "exception-a",
        )

        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(
            sql,
            "SELECT id FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s AND matcher_type=%s AND matcher_value=%s AND id<>%s",
        )
        self.assertEqual(params, ("company-a", "user-a", "sender_domain", "example.com", "exception-a"))


if __name__ == "__main__":
    unittest.main()
