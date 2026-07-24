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
    MailAutoClassificationPolicyUpdateRequest,
    MailAutoClassificationRuleCreateRequest,
    MailAutoClassificationRulesDeleteRequest,
    MailAutoClassificationRulesOrderRequest,
)
from app.services.mail_auto_classification_service import (
    AutoClassificationConflictError,
    AutoClassificationDecision,
    AutoClassificationTargetInUseError,
    condition_matches,
    normalize_condition_value,
    MailAutoClassificationService,
)
from app.services.mail_messenger_service import MailMessengerService


class Ui026MigrationAndConditionTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_migration_has_owner_scope_constraints_and_events(self):
        sql = (self.root / "migrations" / "030_mail_auto_classification.sql").read_text(encoding="utf-8").lower()
        for marker in (
            "create table if not exists mail_auto_classification_policies",
            "create table if not exists mail_auto_classification_rules",
            "create table if not exists mail_auto_classification_conditions",
            "create table if not exists mail_auto_classification_rule_tags",
            "create table if not exists mail_auto_classification_events",
            "unique (company_id, user_id)",
            "unique (company_id, user_id, priority)",
            "unique (rule_id, position)",
            "unique (rule_id, tag_id)",
            "on delete restrict",
            "idx_mail_auto_classification_rules_owner_priority",
            "idx_mail_auto_classification_events_owner_created",
            "check (result in ('applied', 'matched_noop', 'failed'))",
        ):
            self.assertIn(marker, sql)

    def test_normalization_and_literal_matching_contract(self):
        self.assertEqual(normalize_condition_value("sender_email", "equals", " VIP@예시.한국 "), "vip@xn--vv4b11d.xn--3e0b707e")
        self.assertEqual(normalize_condition_value("sender_domain", "subdomain", "@예시.한국"), "xn--vv4b11d.xn--3e0b707e")
        self.assertEqual(normalize_condition_value("subject", "contains", "  분기 보고  "), "분기 보고")
        self.assertIsNone(normalize_condition_value("attachment", "exists", None))
        context = {
            "sender_email": "vip@mail.example.com", "sender_domain": "mail.example.com",
            "recipient_email": "user@example.com", "subject": "2026 분기 보고",
            "body": "검토 부탁드립니다.", "has_attachment": True,
        }
        self.assertTrue(condition_matches("sender_domain", "subdomain", "example.com", context))
        self.assertTrue(condition_matches("subject", "starts_with", "2026", context))
        self.assertTrue(condition_matches("body", "contains", ".", context))
        self.assertTrue(condition_matches("attachment", "exists", None, context))
        self.assertFalse(condition_matches("subject", "equals", ".*", context))
        self.assertFalse(condition_matches("attachment", "missing", None, context))

    def test_invalid_condition_combinations_are_rejected(self):
        invalid = (
            ("sender_email", "starts_with", "a@example.com"),
            ("sender_domain", "contains", "example.com"),
            ("body", "equals", "body"),
            ("attachment", "exists", "unexpected"),
            ("subject", "contains", " "),
        )
        for field, operator, value in invalid:
            with self.subTest(field=field, operator=operator), self.assertRaises(ValueError):
                normalize_condition_value(field, operator, value)


class Ui026SchemaAndRouteTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_schema_enforces_conditions_actions_limits_and_versions(self):
        payload = MailAutoClassificationRuleCreateRequest(
            name=" 중요 보고 ", enabled=True,
            conditions=[{"field": "subject", "operator": "contains", "value": "보고"}],
            targetFolderId="folder-1", tagIds=["tag-1", "tag-1", "tag-2"],
        )
        self.assertEqual(payload.name, "중요 보고")
        self.assertEqual(payload.tagIds, ["tag-1", "tag-2"])
        for invalid in (
            {"name": "x", "conditions": [], "targetFolderId": "folder-1"},
            {"name": "x", "conditions": [{"field": "subject", "operator": "contains", "value": "x"}]},
            {"name": "x", "conditions": [{"field": "subject", "operator": "contains", "value": "x"}] * 6, "tagIds": ["t"]},
            {"name": "x", "conditions": [{"field": "subject", "operator": "contains", "value": "x"}], "tagIds": [f"t{i}" for i in range(6)]},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                MailAutoClassificationRuleCreateRequest(**invalid)
        with self.assertRaises(ValidationError):
            MailAutoClassificationPolicyUpdateRequest(enabled=True, version=0)
        with self.assertRaises(ValidationError):
            MailAutoClassificationRulesDeleteRequest(ruleIds=[])
        with self.assertRaises(ValidationError):
            MailAutoClassificationRulesOrderRequest(ruleIds=["r1", "r1"], version=1)

    def test_conflicts_have_safe_distinct_codes(self):
        for exc, code in (
            (AutoClassificationConflictError("충돌"), "MAIL_AUTO_CLASSIFICATION_RULE_CONFLICT"),
            (AutoClassificationTargetInUseError("사용 중"), "MAIL_AUTO_CLASSIFICATION_TARGET_IN_USE"),
        ):
            with self.subTest(code=code), self.assertRaises(HTTPException) as captured:
                _handle_error(exc)
            self.assertEqual(captured.exception.status_code, 409)
            self.assertEqual(captured.exception.detail["code"], code)

    def test_routes_precede_dynamic_mail_route_and_are_authenticated(self):
        source = (self.root / "app" / "api" / "routes" / "mail.py").read_text(encoding="utf-8")
        markers = (
            '@router.get("/settings/auto-classification"',
            '@router.patch("/settings/auto-classification"',
            '@router.post("/settings/auto-classification/rules"',
            '@router.patch("/settings/auto-classification/rules/order"',
            '@router.post("/settings/auto-classification/rules/delete"',
            '@router.patch("/settings/auto-classification/rules/{rule_id}"',
            '@router.delete("/settings/auto-classification/rules/{rule_id}"',
        )
        for marker in markers:
            self.assertIn(marker, source)
        self.assertLess(source.index(markers[0]), source.index('@router.get("/{mail_id}"'))
        section = source[source.index(markers[0]):source.index('@router.post("/{mail_id}/category"')]
        self.assertGreaterEqual(section.count('permission_required("mail:read")'), 7)


class Ui026DeterministicEvaluatorTests(unittest.TestCase):
    def test_decision_first_folder_and_accumulated_unique_tags(self):
        rules = [
            {"id": "r1", "priority": 10, "target_folder_id": "folder-1", "tag_ids": ["tag-1"],
             "conditions": [{"field": "subject", "operator": "contains", "value": "보고"}]},
            {"id": "r2", "priority": 20, "target_folder_id": "folder-2", "tag_ids": ["tag-1", "tag-2"],
             "conditions": [{"field": "subject", "operator": "ends_with", "value": "완료"}]},
        ]
        context = {"sender_email": "a@example.com", "sender_domain": "example.com", "recipient_email": "u@example.com", "subject": "보고 완료", "body": "", "has_attachment": False}
        decision = AutoClassificationDecision.from_rules(rules, context)
        self.assertEqual(decision.folderId, "folder-1")
        self.assertEqual(decision.tagIds, ["tag-1", "tag-2"])
        self.assertEqual(decision.matchedRuleIds, ["r1", "r2"])

    def test_all_conditions_are_and_and_priority_tie_uses_id(self):
        rules = [
            {"id": "b", "priority": 10, "target_folder_id": "folder-b", "tag_ids": [], "conditions": [{"field": "subject", "operator": "contains", "value": "보고"}, {"field": "attachment", "operator": "exists", "value": None}]},
            {"id": "a", "priority": 10, "target_folder_id": "folder-a", "tag_ids": [], "conditions": [{"field": "subject", "operator": "contains", "value": "보고"}]},
        ]
        context = {"sender_email": "a@example.com", "sender_domain": "example.com", "recipient_email": "u@example.com", "subject": "보고", "body": "", "has_attachment": False}
        decision = AutoClassificationDecision.from_rules(rules, context)
        self.assertEqual(decision.folderId, "folder-a")
        self.assertEqual(decision.matchedRuleIds, ["a"])

    def test_messenger_wrapper_passes_owner_scoped_context_to_common_engine(self):
        service = MailMessengerService()
        service.auto_classification = Mock()
        cursor = Mock()
        now = datetime(2026, 7, 24, tzinfo=UTC)
        service._apply_auto_classification(
            cursor, company_id="company-a", recipient_user_id="user-a",
            actor_user_id="sender-a", actor_user_name="발신자", mail_id="mail-a",
            recipient_id="recipient-a", sender_email="sender@example.com",
            recipient_email="user@example.com", subject="보고", body="본문",
            has_attachment=True, now=now,
        )
        payload = service.auto_classification.apply_recipient.call_args.kwargs
        self.assertEqual(payload["company_id"], "company-a")
        self.assertEqual(payload["user_id"], "user-a")
        self.assertEqual(payload["context"]["sender_domain"], "example.com")
        self.assertTrue(payload["context"]["has_attachment"])


class Ui026StaticSafetyTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_receive_paths_apply_after_spam_and_scheduled_only_once(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        save = source[source.index("    def _save_mail("):source.index("    def _write_mail_delivery_audit(")]
        self.assertLess(save.index("_evaluate_recipient_spam"), save.index("_apply_auto_classification"))
        self.assertIn("spam_decision.decision != \"spam\"", save)
        dispatch = source[source.index("    def dispatch_scheduled_mail"):source.index("    def mark_mail_read")]
        self.assertIn("received_at IS NULL", dispatch)
        self.assertIn("_apply_auto_classification", dispatch)

    def test_sensitive_content_is_not_written_to_event_or_audit(self):
        source = (self.root / "app" / "services" / "mail_auto_classification_service.py").read_text(encoding="utf-8").lower()
        audit = source[source.index("def _audit"):]
        for forbidden in ("body_text", "subject", "recipient_emails", "condition_value"):
            self.assertNotIn(forbidden, audit)
        self.assertNotIn('f"select', source)
        self.assertNotIn('f"update', source)


class BulkEvaluationCursor:
    def __init__(self, rule_count: int = 3):
        self.rule_count = rule_count
        self.executions: list[tuple[str, tuple]] = []
        self.next_one = None
        self.next_all: list[dict] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executions.append((normalized, tuple(params)))
        upper = normalized.upper()
        self.next_one = None
        self.next_all = []
        if upper.startswith("SELECT ENABLED FROM MAIL_AUTO_CLASSIFICATION_POLICIES"):
            self.next_one = {"enabled": True}
        elif upper.startswith("SELECT ID, ENABLED, PRIORITY, TARGET_FOLDER_ID FROM MAIL_AUTO_CLASSIFICATION_RULES"):
            self.next_all = [{"id": f"r{index}", "enabled": True, "priority": index * 10, "target_folder_id": None} for index in range(1, self.rule_count + 1)]
        elif "FROM MAIL_AUTO_CLASSIFICATION_CONDITIONS" in upper:
            if "ANY(" in upper:
                self.next_all = [{"rule_id": f"r{index}", "field": "subject", "operator": "contains", "value": "보고", "position": 1} for index in range(1, self.rule_count + 1)]
            else:
                self.next_all = [{"field": "subject", "operator": "contains", "value": "보고"}]
        elif "FROM MAIL_AUTO_CLASSIFICATION_RULE_TAGS" in upper:
            self.next_all = []

    def fetchone(self):
        value, self.next_one = self.next_one, None
        return value

    def fetchall(self):
        values, self.next_all = self.next_all, []
        return values


class EvidenceFailureCursor:
    def __init__(self, *, rollback_fails: bool = False):
        self.rollback_fails = rollback_fails
        self.executions: list[str] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executions.append(normalized)
        upper = normalized.upper()
        if upper.startswith("SELECT ENABLED FROM MAIL_AUTO_CLASSIFICATION_POLICIES"):
            raise RuntimeError("evaluator exploded")
        if upper == "ROLLBACK TO SAVEPOINT AUTO_CLASSIFICATION" and self.rollback_fails:
            raise RuntimeError("transaction rollback failed")
        if upper.startswith("INSERT INTO MAIL_AUTO_CLASSIFICATION_EVENTS"):
            raise RuntimeError("evidence insert failed")


class RecordingCursor:
    def __init__(self):
        self.executions: list[tuple[str, tuple]] = []

    def execute(self, sql, params=()):
        self.executions.append((" ".join(str(sql).split()), tuple(params)))


class Ui026IndependentReviewRemediationTests(unittest.TestCase):
    root = Path(__file__).parent

    def test_reorder_uses_positive_offset_compatible_with_priority_check(self):
        source = (self.root / "app" / "services" / "mail_auto_classification_service.py").read_text(encoding="utf-8")
        reorder = source[source.index("    def reorder_rules"):source.index("    def evaluate_recipient")]
        self.assertNotIn("priority = -priority", reorder)
        self.assertIn("priority = priority + %s", reorder)
        self.assertIn("temporary_priority_offset", reorder)

    def test_recipient_evaluation_uses_fixed_four_queries_for_many_rules(self):
        cursor = BulkEvaluationCursor(rule_count=50)
        context = {"sender_email": "a@example.com", "sender_domain": "example.com", "recipient_email": "u@example.com", "subject": "보고", "body": "", "has_attachment": False}
        decision = MailAutoClassificationService().evaluate_recipient(cursor, "company-a", "user-a", context)
        self.assertEqual(len(cursor.executions), 4)
        self.assertEqual(len(decision.matchedRuleIds), 50)
        self.assertTrue(all(params[:2] == ("company-a", "user-a") for _, params in cursor.executions[:2]))

    def test_failed_evidence_is_best_effort_and_keeps_inbox_fail_open(self):
        service = MailAutoClassificationService()
        cursor = EvidenceFailureCursor()
        with self.assertLogs("app.services.mail_auto_classification_service", level="ERROR"):
            decision = service.apply_recipient(cursor, company_id="company-a", user_id="user-a", actor_user_id="sender-a", actor_user_name="발신자", mail_id="mail-a", recipient_id="recipient-a", context={}, now=datetime(2026, 7, 24, tzinfo=UTC))
        self.assertEqual(decision, AutoClassificationDecision([], None, []))
        self.assertIn("SAVEPOINT auto_classification_evidence", cursor.executions)
        self.assertIn("ROLLBACK TO SAVEPOINT auto_classification_evidence", cursor.executions)

    def test_failed_primary_savepoint_rollback_still_propagates_transaction_failure(self):
        service = MailAutoClassificationService()
        with self.assertRaisesRegex(RuntimeError, "transaction rollback failed"):
            service.apply_recipient(EvidenceFailureCursor(rollback_fails=True), company_id="company-a", user_id="user-a", actor_user_id="sender-a", actor_user_name="발신자", mail_id="mail-a", recipient_id="recipient-a", context={}, now=datetime(2026, 7, 24, tzinfo=UTC))

    def test_scheduled_recipient_query_includes_email_without_per_row_fallback(self):
        source = (self.root / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        dispatch = source[source.index("    def dispatch_scheduled_mail"):source.index("    def mark_mail_read")]
        self.assertIn("SELECT id, recipient_user_id, recipient_email FROM mail_recipients", dispatch)
        self.assertNotIn("SELECT recipient_email FROM mail_recipients WHERE id", dispatch)
        self.assertNotIn("invalid.test", dispatch)

    def test_event_rows_record_each_matched_rule_actual_actions(self):
        service = MailAutoClassificationService()
        service.evaluate_recipient = Mock(return_value=AutoClassificationDecision(
            ["folder-rule", "tag-rule"], "folder-a", ["tag-a", "tag-b"],
            ruleActions={
                "folder-rule": {"folderApplied": True, "tagCount": 0},
                "tag-rule": {"folderApplied": False, "tagCount": 2},
            },
        ))
        cursor = RecordingCursor()
        service.apply_recipient(cursor, company_id="company-a", user_id="user-a", actor_user_id="sender-a", actor_user_name="발신자", mail_id="mail-a", recipient_id="recipient-a", context={}, now=datetime(2026, 7, 24, tzinfo=UTC))
        events = [params for sql, params in cursor.executions if sql.upper().startswith("INSERT INTO MAIL_AUTO_CLASSIFICATION_EVENTS")]
        self.assertEqual([(params[3], params[7], params[8]) for params in events], [("folder-rule", True, 0), ("tag-rule", False, 2)])


if __name__ == "__main__":
    unittest.main()
