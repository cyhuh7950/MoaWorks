from __future__ import annotations

import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.mail import _handle_error
from app.schemas.mail_messenger import (
    MailSpamPolicyUpdateRequest,
    MailSpamRuleCreateRequest,
    MailSpamRuleUpdateRequest,
)
from app.services.spam_settings_service import (
    SpamDecision,
    SpamRuleConflictError,
    SpamSettingsConflictError,
    SpamSettingsService,
    domain_matches,
    normalize_spam_domain,
    normalize_spam_email,
)
from app.services.mail_messenger_service import MailMessengerService
from test_ui016_mail_list import FakeDb


class DecisionCursor:
    def __init__(self, *, enabled: bool = True, rules: list[dict] | None = None):
        self.enabled = enabled
        self.rules = rules or []
        self.next_one = None
        self.next_all: list[dict] = []
        self.executions: list[tuple[str, tuple]] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executions.append((normalized, tuple(params)))
        upper = normalized.upper()
        if upper.startswith("SELECT FILTER_ENABLED FROM USER_SPAM_POLICIES"):
            self.next_one = {"filter_enabled": self.enabled}
        elif upper.startswith("SELECT ID, RULE_TYPE, MATCH_TYPE, MATCH_VALUE FROM USER_SPAM_RULES"):
            self.next_all = [dict(item) for item in self.rules if item.get("enabled", True)]

    def fetchone(self):
        value, self.next_one = self.next_one, None
        return value

    def fetchall(self):
        values, self.next_all = self.next_all, []
        return values


class ScheduledDispatchCursor:
    def __init__(self):
        now = datetime(2026, 7, 24, 4, 0, tzinfo=UTC)
        self.messages = [{"id": "scheduled-1", "company_id": "company-a", "sender_user_id": "sender-a", "sender_email": "bad@example.com"}]
        self.recipients = [
            {"id": "rcpt-deny", "recipient_user_id": "user-deny", "recipient_email": "deny@example.test"},
            {"id": "rcpt-allow", "recipient_user_id": "user-allow", "recipient_email": "allow@example.test"},
            {"id": "rcpt-off", "recipient_user_id": "user-off", "recipient_email": "off@example.test"},
            {"id": "rcpt-error", "recipient_user_id": "user-error", "recipient_email": "error@example.test"},
        ]
        self.policies = {"user-off": {"filter_enabled": False}}
        self.rules = {
            "user-deny": [{"id": "deny-domain", "rule_type": "deny", "match_type": "domain", "match_value": "example.com"}],
            "user-allow": [
                {"id": "deny-domain-2", "rule_type": "deny", "match_type": "domain", "match_value": "example.com"},
                {"id": "allow-email", "rule_type": "allow", "match_type": "email", "match_value": "bad@example.com"},
            ],
            "user-off": [{"id": "deny-off", "rule_type": "deny", "match_type": "domain", "match_value": "example.com"}],
        }
        self.next_one = None
        self.next_all: list[dict] = []
        self.executions: list[tuple[str, tuple]] = []
        self.now = now

    def __enter__(self): return self
    def __exit__(self, *_): return False

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        upper = normalized.upper()
        params = tuple(params)
        self.executions.append((normalized, params))
        self.next_one = None
        self.next_all = []
        if upper.startswith("SELECT ID, COMPANY_ID, SENDER_USER_ID"):
            self.next_all = [dict(row) for row in self.messages]
        elif upper.startswith("SELECT ID, RECIPIENT_USER_ID, RECIPIENT_EMAIL FROM MAIL_RECIPIENTS"):
            self.next_all = [dict(row) for row in self.recipients]
        elif upper.startswith("SELECT FILTER_ENABLED FROM USER_SPAM_POLICIES"):
            user_id = params[1]
            if user_id == "user-error":
                raise RuntimeError("spam evaluator failed")
            self.next_one = self.policies.get(user_id)
        elif upper.startswith("SELECT ID, RULE_TYPE, MATCH_TYPE, MATCH_VALUE FROM USER_SPAM_RULES"):
            self.next_all = [dict(row) for row in self.rules.get(params[1], [])]

    def fetchone(self):
        value, self.next_one = self.next_one, None
        return value

    def fetchall(self):
        values, self.next_all = self.next_all, []
        return values


class ScheduledDispatchConnection:
    def __init__(self, cursor): self.cursor_value, self.commit_count = cursor, 0
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def cursor(self): return self.cursor_value
    def commit(self): self.commit_count += 1


class ScheduledDispatchDb:
    def __init__(self):
        self.cursor_instance = ScheduledDispatchCursor()
        self.connection = ScheduledDispatchConnection(self.cursor_instance)
    def ensure_migrations_applied(self): return None
    def connect(self): return self.connection


class Ui025MigrationAndNormalizationTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_has_owner_scoped_policy_rule_constraints_and_index(self):
        sql = (self.root / "migrations" / "029_spam_settings.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists user_spam_policies",
            "create table if not exists user_spam_rules",
            "unique (company_id, user_id)",
            "unique (company_id, user_id, match_type, match_value)",
            "check (rule_type in ('allow', 'deny'))",
            "check (match_type in ('email', 'domain'))",
            "check (blocked_action = 'move_to_spam')",
            "references users(id) on delete cascade",
            "idx_user_spam_rules_owner_filter",
        ):
            self.assertIn(marker, sql)

    def test_email_and_domain_normalization_and_boundary_match(self):
        self.assertEqual(normalize_spam_email("  VIP@예시.한국  "), "vip@xn--vv4b11d.xn--3e0b707e")
        self.assertEqual(normalize_spam_domain(" @예시.한국 "), "xn--vv4b11d.xn--3e0b707e")
        self.assertTrue(domain_matches("example.com", "example.com"))
        self.assertTrue(domain_matches("mail.example.com", "example.com"))
        self.assertFalse(domain_matches("badexample.com", "example.com"))

    def test_invalid_rule_values_are_rejected(self):
        invalid_emails = ("Name <a@example.com>", "a@@example.com", "a b@example.com", "a@localhost", "a..b@example.com")
        invalid_domains = ("*.example.com", "https://example.com", "example.com/path", "example.com:25", ".example.com", "example.com.", "example..com")
        for value in invalid_emails:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_spam_email(value)
        for value in invalid_domains:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_spam_domain(value)

    def test_typed_requests_reject_unsupported_values_and_versions(self):
        valid = MailSpamRuleCreateRequest(ruleType="allow", matchType="domain", matchValue="@example.com")
        self.assertEqual(valid.ruleType, "allow")
        with self.assertRaises(ValidationError):
            MailSpamRuleCreateRequest(ruleType="block", matchType="domain", matchValue="example.com")
        with self.assertRaises(ValidationError):
            MailSpamRuleUpdateRequest(ruleType="deny", matchType="ip", matchValue="127.0.0.1", enabled=True)
        with self.assertRaises(ValidationError):
            MailSpamPolicyUpdateRequest(filterEnabled=True, blockedAction="delete", expectedVersion=1)
        with self.assertRaises(ValidationError):
            MailSpamPolicyUpdateRequest(filterEnabled=True, blockedAction="move_to_spam", expectedVersion=0)


class Ui025DecisionTests(unittest.TestCase):
    def setUp(self):
        self.service = SpamSettingsService()

    def evaluate(self, sender: str, rules: list[dict], *, enabled: bool = True) -> SpamDecision:
        return self.service.evaluate_sender(DecisionCursor(enabled=enabled, rules=rules), "company-a", "user-a", sender)

    @staticmethod
    def rule(rule_id: str, rule_type: str, match_type: str, value: str) -> dict:
        return {"id": rule_id, "rule_type": rule_type, "match_type": match_type, "match_value": value, "enabled": True}

    def test_filter_disabled_and_no_match_are_inbox(self):
        self.assertEqual(self.evaluate("sender@example.com", [self.rule("r", "deny", "domain", "example.com")], enabled=False).decision, "inbox")
        self.assertEqual(self.evaluate("sender@safe.test", [self.rule("r", "deny", "domain", "example.com")]).decision, "inbox")

    def test_allow_rules_override_all_deny_rules(self):
        decision = self.evaluate("vip@mail.example.com", [
            self.rule("deny-email", "deny", "email", "vip@mail.example.com"),
            self.rule("deny-domain", "deny", "domain", "example.com"),
            self.rule("allow-domain", "allow", "domain", "mail.example.com"),
        ])
        self.assertEqual((decision.decision, decision.matchedRuleId), ("inbox", "allow-domain"))

    def test_exact_allow_precedes_domain_allow_and_email_deny_precedes_domain_deny(self):
        allow = self.evaluate("vip@example.com", [
            self.rule("allow-domain", "allow", "domain", "example.com"),
            self.rule("allow-email", "allow", "email", "vip@example.com"),
        ])
        deny = self.evaluate("bad@example.com", [
            self.rule("deny-domain", "deny", "domain", "example.com"),
            self.rule("deny-email", "deny", "email", "bad@example.com"),
        ])
        self.assertEqual(allow.matchedRuleId, "allow-email")
        self.assertEqual((deny.decision, deny.matchedRuleId), ("spam", "deny-email"))

    def test_queries_are_company_and_user_scoped(self):
        cursor = DecisionCursor()
        self.service.evaluate_sender(cursor, "company-a", "user-a", "sender@example.com")
        self.assertTrue(cursor.executions)
        self.assertTrue(all(params == ("company-a", "user-a") for _, params in cursor.executions))


class Ui025OwnerScopedCrudTests(unittest.TestCase):
    @staticmethod
    def actor():
        return SimpleNamespace(companyId="company-a", userId="user-a", userName="사용자", userEmail="user@example.com")

    def test_stale_policy_version_does_not_commit(self):
        service = SpamSettingsService()
        service.db = FakeDb(fetchone=[{"id": "policy-1", "version": 2}])
        with self.assertRaises(SpamSettingsConflictError):
            service.update_policy(self.actor(), MailSpamPolicyUpdateRequest(filterEnabled=False, blockedAction="move_to_spam", expectedVersion=1))
        self.assertEqual(service.db.connection.commit_count, 0)

    def test_rule_limit_counts_disabled_rules_and_does_not_commit(self):
        service = SpamSettingsService()
        service.db = FakeDb(fetchone=[None, {"total": 200}])
        with self.assertRaises(ValueError):
            service.create_rule(self.actor(), MailSpamRuleCreateRequest(ruleType="deny", matchType="domain", matchValue="example.com", enabled=False))
        self.assertEqual(service.db.connection.commit_count, 0)

    def test_allow_deny_conflict_uses_same_match_key(self):
        service = SpamSettingsService()
        service.db = FakeDb(fetchone=[{"id": "existing-deny"}])
        with self.assertRaises(SpamRuleConflictError):
            service.create_rule(self.actor(), MailSpamRuleCreateRequest(ruleType="allow", matchType="email", matchValue="VIP@EXAMPLE.COM"))
        params = service.db.cursor_instance.executions[-1][1]
        self.assertEqual(params, ("company-a", "user-a", "email", "vip@example.com"))
        self.assertEqual(service.db.connection.commit_count, 0)

    def test_unowned_update_and_delete_are_forbidden_without_commit(self):
        payload = MailSpamRuleUpdateRequest(ruleType="deny", matchType="domain", matchValue="example.com", enabled=True)
        for operation in ("update", "delete"):
            service = SpamSettingsService()
            service.db = FakeDb(fetchone=[None])
            with self.subTest(operation=operation), self.assertRaises(PermissionError):
                if operation == "update":
                    service.update_rule(self.actor(), "unowned", payload)
                else:
                    service.delete_rule(self.actor(), "unowned")
            self.assertEqual(service.db.connection.commit_count, 0)

    def test_service_sql_and_audit_exclude_sensitive_values(self):
        source = (Path(__file__).parent / "app" / "services" / "spam_settings_service.py").read_text(encoding="utf-8").lower()
        self.assertNotIn("f\"select", source)
        self.assertNotIn("f\"update", source)
        self.assertIn("changed_fields", source)
        self.assertNotIn("password", source)
        self.assertNotIn("body_text", source)


class Ui025RecipientPathIntegrationTests(unittest.TestCase):
    @staticmethod
    def actor():
        return SimpleNamespace(companyId="company-a", userId="sender-a", userName="발신자")

    def test_common_path_returns_spam_decision_and_releases_savepoint(self):
        cursor = DecisionCursor()
        service = MailMessengerService()
        service.spam_settings = Mock()
        service.spam_settings.evaluate_sender.return_value = SpamDecision("spam", "rule-1", "deny", "email")
        decision = service._evaluate_recipient_spam(cursor, self.actor(), "recipient-a", "sender@example.com", "mail-1")
        self.assertEqual((decision.decision, decision.matchedRuleId), ("spam", "rule-1"))
        self.assertEqual(cursor.executions[0][0], "SAVEPOINT spam_evaluation")
        self.assertEqual(cursor.executions[-1][0], "RELEASE SAVEPOINT spam_evaluation")

    def test_scheduled_dispatch_classifies_each_internal_recipient_at_delivery_time(self):
        service = MailMessengerService()
        service.db = ScheduledDispatchDb()
        service.spam_settings = SpamSettingsService()
        service._now = lambda: service.db.cursor_instance.now
        with self.assertLogs("app.services.mail_messenger_service", level="ERROR") as captured:
            dispatched = service.dispatch_scheduled_mail(limit=10)
        self.assertEqual(dispatched, 1)
        updates = [params for sql, params in service.db.cursor_instance.executions if sql.upper().startswith("UPDATE MAIL_RECIPIENTS SET RECEIVED_AT")]
        by_recipient = {params[3]: params for params in updates}
        self.assertEqual(set(by_recipient), {"rcpt-deny", "rcpt-allow", "rcpt-off", "rcpt-error"})
        self.assertIs(by_recipient["rcpt-deny"][1], True)
        self.assertIsNotNone(by_recipient["rcpt-deny"][2])
        for recipient_id in ("rcpt-allow", "rcpt-off", "rcpt-error"):
            self.assertIs(by_recipient[recipient_id][1], False)
            self.assertIsNone(by_recipient[recipient_id][2])
        classified = [params for sql, params in service.db.cursor_instance.executions if "MAIL.SPAM.MESSAGE.CLASSIFIED" in sql.upper()]
        self.assertEqual(len(classified), 4)
        self.assertTrue(any("user-error" in line for line in captured.output))
        self.assertEqual(service.db.connection.commit_count, 1)

    def test_scheduled_dispatch_keeps_external_queue_and_status_contract(self):
        source = (Path(__file__).parent / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        dispatch = source[source.index("    def dispatch_scheduled_mail"):source.index("    def mark_mail_read")]
        self.assertIn("JOIN mail_recipients r ON r.message_id = m.id AND r.recipient_user_id IS NULL", dispatch)
        self.assertIn("CASE WHEN p.delivery_enabled AND p.last_test_status = 'success' THEN 'queued' ELSE 'blocked' END", dispatch)
        self.assertIn("UPDATE mail_messages SET status = 'sent'", dispatch)

    def test_evaluator_failure_rolls_back_savepoint_and_fails_open(self):
        cursor = DecisionCursor()
        service = MailMessengerService()
        service.spam_settings = Mock()
        service.spam_settings.evaluate_sender.side_effect = RuntimeError("evaluator failed")
        with self.assertLogs("app.services.mail_messenger_service", level="ERROR"):
            decision = service._evaluate_recipient_spam(cursor, self.actor(), "recipient-a", "sender@example.com", "mail-1")
        self.assertEqual(decision.decision, "inbox")
        self.assertIn("ROLLBACK TO SAVEPOINT spam_evaluation", [sql for sql, _ in cursor.executions])
        self.assertEqual(cursor.executions[-1][0], "RELEASE SAVEPOINT spam_evaluation")


class Ui025RouteAndStaticContractTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_conflicts_map_to_distinct_safe_409_codes(self):
        for error, code in (
            (SpamRuleConflictError("규칙 충돌"), "MAIL_SPAM_RULE_CONFLICT"),
            (SpamSettingsConflictError("버전 충돌"), "MAIL_SPAM_SETTINGS_CONFLICT"),
        ):
            with self.subTest(code=code), self.assertRaises(HTTPException) as captured:
                _handle_error(error)
            self.assertEqual(captured.exception.status_code, 409)
            self.assertEqual(captured.exception.detail["code"], code)

    def test_routes_precede_dynamic_mail_route_and_require_mail_read(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        markers = (
            '@router.get("/spam-settings"',
            '@router.patch("/spam-settings"',
            '@router.post("/spam-settings/rules"',
            '@router.patch("/spam-settings/rules/{rule_id}"',
            '@router.delete("/spam-settings/rules/{rule_id}"',
        )
        for marker in markers:
            self.assertIn(marker, source)
        self.assertLess(source.index('@router.get("/spam-settings"'), source.index('@router.get("/{mail_id}"'))
        spam_route_source = source[source.index('@router.get("/spam-settings"'):source.index('@router.post("/{mail_id}/category"')]
        self.assertGreaterEqual(spam_route_source.count('permission_required("mail:read")'), 5)

    def test_common_recipient_path_classifies_only_new_internal_receipts(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        save_mail = source[source.index("    def _save_mail("):source.index("    def _write_mail_delivery_audit(")]
        for marker in ("evaluate_sender", "is_spam", "spam_marked_at", "mail.spam.message.classified"):
            self.assertIn(marker, save_mail)
        self.assertIn('status_value == "sent" and recipient_user_id', save_mail)

    def test_frontend_contract_is_same_origin_and_complete(self):
        app = (self.root.parent / "frontend" / "user-web" / "src" / "App.tsx").read_text(encoding="utf-8")
        api = (self.root.parent / "frontend" / "user-web" / "src" / "api.ts").read_text(encoding="utf-8")
        css = (self.root.parent / "frontend" / "user-web" / "src" / "global.css").read_text(encoding="utf-8")
        for marker in ("MailSpamSettingsPanel", "스팸 필터 사용", "규칙 추가", "구분", "대상", "생성일", "user-mail-spam-settings"):
            self.assertIn(marker, app + css)
        for marker in ('"/mail/spam-settings"', '`/mail/spam-settings/rules/${encodeURIComponent(ruleId)}`'):
            self.assertIn(marker, api)
        spam_api = api[api.index("// UI-025 spam settings"):]
        for forbidden in ("http://", "https://", "localhost", "127.0.0.1", "NEXT_PUBLIC_"):
            self.assertNotIn(forbidden, spam_api)


if __name__ == "__main__":
    unittest.main()
