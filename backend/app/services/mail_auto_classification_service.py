from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from datetime import UTC, datetime
import json
import logging
import uuid

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAutoClassificationCondition, MailAutoClassificationLastEvent,
    MailAutoClassificationPolicyUpdateRequest, MailAutoClassificationRuleCreateRequest,
    MailAutoClassificationRuleUpdateRequest, MailAutoClassificationRuleView,
    MailAutoClassificationRulesDeleteRequest, MailAutoClassificationRulesOrderRequest,
    MailAutoClassificationSettingsResponse, MailFolderView, MailTagView,
)
from app.services.postgres_service import PostgresService
from app.services.spam_settings_service import domain_matches, normalize_spam_domain, normalize_spam_email


logger = logging.getLogger(__name__)


class AutoClassificationConflictError(RuntimeError):
    pass


class AutoClassificationPolicyConflictError(AutoClassificationConflictError):
    pass


class AutoClassificationLimitError(AutoClassificationConflictError):
    pass


class AutoClassificationTargetInUseError(AutoClassificationConflictError):
    pass


class AutoClassificationTargetForbiddenError(PermissionError):
    pass


_OPERATORS = {
    "sender_email": {"equals", "contains"}, "recipient_email": {"equals", "contains"},
    "sender_domain": {"equals", "subdomain"},
    "subject": {"contains", "equals", "starts_with", "ends_with"},
    "body": {"contains"}, "attachment": {"exists", "missing"},
}


def normalize_condition_value(field: str, operator: str, value: str | None) -> str | None:
    if field not in _OPERATORS or operator not in _OPERATORS[field]:
        raise ValueError("지원하지 않는 자동분류 조건입니다.")
    if field == "attachment":
        if value not in (None, ""):
            raise ValueError("첨부 조건에는 값을 입력할 수 없습니다.")
        return None
    candidate = (value or "").strip()
    if not candidate:
        raise ValueError("조건 값을 입력해 주세요.")
    if field in {"sender_email", "recipient_email"}:
        if operator == "equals":
            normalized = normalize_spam_email(candidate)
        else:
            normalized = candidate.casefold()
        if len(normalized) > 254:
            raise ValueError("이메일 조건은 최대 254자입니다.")
        return normalized
    if field == "sender_domain":
        return normalize_spam_domain(candidate)
    if len(candidate) > 200:
        raise ValueError("문자열 조건은 최대 200자입니다.")
    return candidate


def condition_matches(field: str, operator: str, value: str | None, context: dict) -> bool:
    if field == "attachment":
        present = bool(context.get("has_attachment"))
        return present if operator == "exists" else not present
    source = str(context.get(field, ""))
    expected = value or ""
    if field == "sender_domain" and operator == "subdomain":
        return domain_matches(source.casefold(), expected.casefold())
    left, right = source.casefold(), expected.casefold()
    if operator == "equals": return left == right
    if operator == "contains": return right in left
    if operator == "starts_with": return left.startswith(right)
    if operator == "ends_with": return left.endswith(right)
    return False


@dataclass(frozen=True)
class AutoClassificationDecision:
    matchedRuleIds: list[str]
    folderId: str | None
    tagIds: list[str]
    ruleActions: dict[str, dict[str, int | bool]] = dataclass_field(default_factory=dict)

    @classmethod
    def from_rules(cls, rules: list[dict], context: dict) -> "AutoClassificationDecision":
        matched: list[str] = []
        folder_id: str | None = None
        tag_ids: list[str] = []
        rule_actions: dict[str, dict[str, int | bool]] = {}
        for rule in sorted(rules, key=lambda item: (int(item["priority"]), str(item["id"]))):
            if not rule.get("enabled", True):
                continue
            if not all(condition_matches(item["field"], item["operator"], item.get("value"), context) for item in rule.get("conditions", [])):
                continue
            matched.append(rule["id"])
            folder_applied = False
            if folder_id is None and rule.get("target_folder_id"):
                folder_id = rule["target_folder_id"]
                folder_applied = True
            contributed_tag_count = 0
            for tag_id in rule.get("tag_ids", []):
                if tag_id not in tag_ids:
                    tag_ids.append(tag_id)
                    contributed_tag_count += 1
            rule_actions[rule["id"]] = {"folderApplied": folder_applied, "tagCount": contributed_tag_count}
        return cls(matched, folder_id, tag_ids, rule_actions)


class MailAutoClassificationService:
    MAX_RULES = 100

    def __init__(self) -> None:
        self.db = PostgresService()

    @staticmethod
    def _now() -> datetime: return datetime.now(UTC)

    @staticmethod
    def _new_id(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex}"

    def get_settings(self, actor: AuthUserSummary) -> MailAutoClassificationSettingsResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT enabled, version, updated_at FROM mail_auto_classification_policies WHERE company_id = %s AND user_id = %s", (actor.companyId, actor.userId))
                policy = cursor.fetchone()
                cursor.execute("SELECT id, name, enabled, priority, version, target_folder_id, created_at, updated_at FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s ORDER BY priority, id", (actor.companyId, actor.userId))
                rows = cursor.fetchall()
                rules = [self._load_rule(cursor, row) for row in rows]
                cursor.execute("SELECT f.id, f.name, f.sort_order FROM mail_user_folders f WHERE f.company_id = %s AND f.user_id = %s ORDER BY f.sort_order, f.created_at", (actor.companyId, actor.userId))
                folders = [MailFolderView(folderId=row["id"], name=row["name"], sortOrder=row["sort_order"], messageCount=0) for row in cursor.fetchall()]
                cursor.execute("SELECT t.id, t.name, t.color, t.sort_order FROM mail_tags t WHERE t.company_id = %s AND t.user_id = %s ORDER BY t.sort_order, t.created_at", (actor.companyId, actor.userId))
                tags = [MailTagView(tagId=row["id"], name=row["name"], color=row["color"], sortOrder=row["sort_order"], messageCount=0) for row in cursor.fetchall()]
        now = self._now()
        return MailAutoClassificationSettingsResponse(enabled=False if policy is None else policy["enabled"], version=1 if policy is None else policy["version"], updatedAt=now if policy is None else policy["updated_at"], rules=rules, folders=folders, tags=tags)

    def update_policy(self, actor: AuthUserSummary, payload: MailAutoClassificationPolicyUpdateRequest) -> MailAutoClassificationSettingsResponse:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT id, version FROM mail_auto_classification_policies WHERE company_id = %s AND user_id = %s FOR UPDATE", (actor.companyId, actor.userId))
                row = cursor.fetchone()
                if row is None:
                    if payload.version != 1: raise AutoClassificationPolicyConflictError("다른 위치에서 정책이 변경되었습니다.")
                    cursor.execute("INSERT INTO mail_auto_classification_policies (id, company_id, user_id, enabled, version, created_at, updated_at) VALUES (%s,%s,%s,%s,2,%s,%s)", (self._new_id("autopolicy"), actor.companyId, actor.userId, payload.enabled, now, now))
                else:
                    if row["version"] != payload.version: raise AutoClassificationPolicyConflictError("다른 위치에서 정책이 변경되었습니다.")
                    cursor.execute("UPDATE mail_auto_classification_policies SET enabled = %s, version = version + 1, updated_at = %s WHERE id = %s AND company_id = %s AND user_id = %s AND version = %s", (payload.enabled, now, row["id"], actor.companyId, actor.userId, payload.version))
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, actor.userId, "mail.auto_classification.policy.updated", {"enabled": payload.enabled, "version": payload.version + 1}, now)
            connection.commit()
        return self.get_settings(actor)

    def create_rule(self, actor: AuthUserSummary, payload: MailAutoClassificationRuleCreateRequest) -> MailAutoClassificationRuleView:
        now = self._now(); rule_id = self._new_id("autorule"); self.db.ensure_migrations_applied()
        conditions = self._normalized_conditions(payload.conditions)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                self._assert_name(cursor, actor, payload.name)
                cursor.execute("SELECT COUNT(*) AS total, COALESCE(MAX(priority), 0) AS max_priority FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s", (actor.companyId, actor.userId))
                count = cursor.fetchone()
                if int(count["total"]) >= self.MAX_RULES: raise AutoClassificationLimitError("자동분류 규칙은 최대 100개입니다.")
                self._assert_targets(cursor, actor, payload.targetFolderId, payload.tagIds)
                priority = int(count["max_priority"]) + 10
                cursor.execute("INSERT INTO mail_auto_classification_rules (id, company_id, user_id, name, enabled, priority, version, target_folder_id, created_at, updated_at) VALUES (%s,%s,%s,%s,%s,%s,1,%s,%s,%s)", (rule_id, actor.companyId, actor.userId, payload.name, payload.enabled, priority, payload.targetFolderId, now, now))
                self._replace_children(cursor, rule_id, conditions, payload.tagIds)
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, rule_id, "mail.auto_classification.rule.created", {"enabled": payload.enabled, "conditionCount": len(conditions), "tagCount": len(payload.tagIds), "targetFolderId": payload.targetFolderId, "version": 1}, now)
            connection.commit()
        return MailAutoClassificationRuleView(ruleId=rule_id, name=payload.name, enabled=payload.enabled, priority=priority, version=1, conditions=[MailAutoClassificationCondition(**item) for item in conditions], targetFolderId=payload.targetFolderId, tagIds=payload.tagIds, createdAt=now, updatedAt=now)

    def update_rule(self, actor: AuthUserSummary, rule_id: str, payload: MailAutoClassificationRuleUpdateRequest) -> MailAutoClassificationRuleView:
        now = self._now(); conditions = self._normalized_conditions(payload.conditions); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT * FROM mail_auto_classification_rules WHERE id = %s AND company_id = %s AND user_id = %s FOR UPDATE", (rule_id, actor.companyId, actor.userId))
                row = cursor.fetchone()
                if row is None: raise AutoClassificationTargetForbiddenError("규칙에 접근할 수 없습니다.")
                if row["version"] != payload.version: raise AutoClassificationConflictError("다른 위치에서 규칙이 변경되었습니다.")
                self._assert_name(cursor, actor, payload.name, rule_id)
                self._assert_targets(cursor, actor, payload.targetFolderId, payload.tagIds)
                cursor.execute("UPDATE mail_auto_classification_rules SET name = %s, enabled = %s, target_folder_id = %s, version = version + 1, updated_at = %s WHERE id = %s AND company_id = %s AND user_id = %s AND version = %s", (payload.name, payload.enabled, payload.targetFolderId, now, rule_id, actor.companyId, actor.userId, payload.version))
                self._replace_children(cursor, rule_id, conditions, payload.tagIds)
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, rule_id, "mail.auto_classification.rule.updated", {"enabled": payload.enabled, "conditionCount": len(conditions), "tagCount": len(payload.tagIds), "targetFolderId": payload.targetFolderId, "version": payload.version + 1}, now)
            connection.commit()
        return MailAutoClassificationRuleView(ruleId=rule_id, name=payload.name, enabled=payload.enabled, priority=row["priority"], version=payload.version + 1, conditions=[MailAutoClassificationCondition(**item) for item in conditions], targetFolderId=payload.targetFolderId, tagIds=payload.tagIds, createdAt=row["created_at"], updatedAt=now)

    def delete_rule(self, actor: AuthUserSummary, rule_id: str) -> None:
        self.delete_rules(actor, MailAutoClassificationRulesDeleteRequest(ruleIds=[rule_id]))

    def delete_rules(self, actor: AuthUserSummary, payload: MailAutoClassificationRulesDeleteRequest) -> None:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT id FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s AND id = ANY(%s) FOR UPDATE", (actor.companyId, actor.userId, payload.ruleIds))
                owned = {row["id"] for row in cursor.fetchall()}
                if owned != set(payload.ruleIds): raise AutoClassificationTargetForbiddenError("규칙에 접근할 수 없습니다.")
                cursor.execute("DELETE FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s AND id = ANY(%s)", (actor.companyId, actor.userId, payload.ruleIds))
                for rule_id in payload.ruleIds: self._audit(cursor, actor.companyId, actor.userId, actor.userName, rule_id, "mail.auto_classification.rule.deleted", {"deleted": True}, now)
            connection.commit()

    def reorder_rules(self, actor: AuthUserSummary, payload: MailAutoClassificationRulesOrderRequest) -> MailAutoClassificationSettingsResponse:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT version FROM mail_auto_classification_policies WHERE company_id = %s AND user_id = %s FOR UPDATE", (actor.companyId, actor.userId))
                policy = cursor.fetchone(); current_version = 1 if policy is None else policy["version"]
                if current_version != payload.version: raise AutoClassificationPolicyConflictError("다른 위치에서 정책이 변경되었습니다.")
                cursor.execute("SELECT id, priority FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s ORDER BY priority, id FOR UPDATE", (actor.companyId, actor.userId))
                owned_rows = cursor.fetchall()
                owned = [row["id"] for row in owned_rows]
                if len(owned) != len(payload.ruleIds) or set(owned) != set(payload.ruleIds): raise AutoClassificationTargetForbiddenError("전체 규칙 순서가 필요합니다.")
                max_priority = max((int(row["priority"]) for row in owned_rows), default=0)
                temporary_priority_offset = max_priority + (len(payload.ruleIds) + 1) * 10
                cursor.execute("UPDATE mail_auto_classification_rules SET priority = priority + %s WHERE company_id = %s AND user_id = %s", (temporary_priority_offset, actor.companyId, actor.userId))
                for index, rule_id in enumerate(payload.ruleIds, 1):
                    cursor.execute("UPDATE mail_auto_classification_rules SET priority = %s, updated_at = %s WHERE id = %s AND company_id = %s AND user_id = %s", (index * 10, now, rule_id, actor.companyId, actor.userId))
                if policy is None:
                    cursor.execute("INSERT INTO mail_auto_classification_policies (id, company_id, user_id, enabled, version, created_at, updated_at) VALUES (%s,%s,%s,FALSE,2,%s,%s)", (self._new_id("autopolicy"), actor.companyId, actor.userId, now, now))
                else:
                    cursor.execute("UPDATE mail_auto_classification_policies SET version = version + 1, updated_at = %s WHERE company_id = %s AND user_id = %s AND version = %s", (now, actor.companyId, actor.userId, payload.version))
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, actor.userId, "mail.auto_classification.rules.reordered", {"ruleCount": len(payload.ruleIds), "version": payload.version + 1}, now)
            connection.commit()
        return self.get_settings(actor)

    def evaluate_recipient(self, cursor, company_id: str, user_id: str, context: dict) -> AutoClassificationDecision:
        cursor.execute("SELECT enabled FROM mail_auto_classification_policies WHERE company_id = %s AND user_id = %s", (company_id, user_id))
        policy = cursor.fetchone()
        if policy is None or not policy["enabled"]: return AutoClassificationDecision([], None, [])
        cursor.execute("SELECT id, enabled, priority, target_folder_id FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s AND enabled = TRUE ORDER BY priority, id", (company_id, user_id))
        rules = [dict(row) for row in cursor.fetchall()]
        if not rules:
            return AutoClassificationDecision([], None, [])
        rule_ids = [row["id"] for row in rules]
        cursor.execute("SELECT rule_id, field, operator, value, position FROM mail_auto_classification_conditions WHERE rule_id = ANY(%s) ORDER BY rule_id, position", (rule_ids,))
        conditions_by_rule: dict[str, list[dict]] = {rule_id: [] for rule_id in rule_ids}
        for row in cursor.fetchall():
            conditions_by_rule[row["rule_id"]].append({"field": row["field"], "operator": row["operator"], "value": row["value"]})
        cursor.execute("SELECT rule_id, tag_id, position FROM mail_auto_classification_rule_tags WHERE rule_id = ANY(%s) ORDER BY rule_id, position", (rule_ids,))
        tags_by_rule: dict[str, list[str]] = {rule_id: [] for rule_id in rule_ids}
        for row in cursor.fetchall():
            tags_by_rule[row["rule_id"]].append(row["tag_id"])
        for rule in rules:
            rule["conditions"] = conditions_by_rule[rule["id"]]
            rule["tag_ids"] = tags_by_rule[rule["id"]]
        return AutoClassificationDecision.from_rules(rules, context)

    def apply_recipient(self, cursor, *, company_id: str, user_id: str, actor_user_id: str, actor_user_name: str, mail_id: str, recipient_id: str, context: dict, now: datetime) -> AutoClassificationDecision:
        cursor.execute("SAVEPOINT auto_classification")
        try:
            decision = self.evaluate_recipient(cursor, company_id, user_id, context)
            if not decision.matchedRuleIds:
                cursor.execute("RELEASE SAVEPOINT auto_classification")
                return decision
            if decision.folderId:
                cursor.execute("UPDATE mail_recipients SET folder_id = %s WHERE id = %s AND recipient_user_id = %s AND is_spam = FALSE", (decision.folderId, recipient_id, user_id))
            for tag_id in decision.tagIds:
                cursor.execute("INSERT INTO mail_recipient_tags (recipient_id, tag_id, created_at) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING", (recipient_id, tag_id, now))
            for rule_id in decision.matchedRuleIds:
                action = decision.ruleActions.get(rule_id, {"folderApplied": False, "tagCount": 0})
                folder_applied = bool(action["folderApplied"])
                tag_count = int(action["tagCount"])
                cursor.execute("INSERT INTO mail_auto_classification_events (id, company_id, user_id, rule_id, mail_id, recipient_id, result, folder_applied, tag_count, reason_code, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (self._new_id("autoevent"), company_id, user_id, rule_id, mail_id, recipient_id, "applied" if folder_applied or tag_count else "matched_noop", folder_applied, tag_count, "RULE_MATCHED", now))
            self._audit(cursor, company_id, actor_user_id, actor_user_name, mail_id, "mail.auto_classification.applied", {"recipientUserId": user_id, "matchedRuleIds": decision.matchedRuleIds, "folderApplied": bool(decision.folderId), "tagCount": len(decision.tagIds), "reasonCode": "RULE_MATCHED"}, now)
            cursor.execute("RELEASE SAVEPOINT auto_classification")
            return decision
        except Exception as evaluator_error:
            cursor.execute("ROLLBACK TO SAVEPOINT auto_classification")
            cursor.execute("RELEASE SAVEPOINT auto_classification")
            cursor.execute("SAVEPOINT auto_classification_evidence")
            try:
                cursor.execute("INSERT INTO mail_auto_classification_events (id, company_id, user_id, rule_id, mail_id, recipient_id, result, folder_applied, tag_count, reason_code, created_at) VALUES (%s,%s,%s,NULL,%s,%s,'failed',FALSE,0,'EVALUATOR_FAILED',%s)", (self._new_id("autoevent"), company_id, user_id, mail_id, recipient_id, now))
                self._audit(cursor, company_id, actor_user_id, actor_user_name, mail_id, "mail.auto_classification.failed", {"recipientUserId": user_id, "matchedRuleIds": [], "folderApplied": False, "tagCount": 0, "reasonCode": "EVALUATOR_FAILED"}, now)
                cursor.execute("RELEASE SAVEPOINT auto_classification_evidence")
            except Exception as evidence_error:
                cursor.execute("ROLLBACK TO SAVEPOINT auto_classification_evidence")
                cursor.execute("RELEASE SAVEPOINT auto_classification_evidence")
                logger.error(
                    "Auto classification failure evidence write failed: company_id=%s user_id=%s mail_id=%s evaluator_error=%s evidence_error=%s",
                    company_id, user_id, mail_id, type(evaluator_error).__name__, type(evidence_error).__name__,
                )
            return AutoClassificationDecision([], None, [])

    def _load_rule(self, cursor, row: dict) -> MailAutoClassificationRuleView:
        cursor.execute("SELECT field, operator, value FROM mail_auto_classification_conditions WHERE rule_id = %s ORDER BY position", (row["id"],))
        conditions = [MailAutoClassificationCondition(**item) for item in cursor.fetchall()]
        cursor.execute("SELECT tag_id FROM mail_auto_classification_rule_tags WHERE rule_id = %s ORDER BY position", (row["id"],))
        tag_ids = [item["tag_id"] for item in cursor.fetchall()]
        cursor.execute("SELECT result, folder_applied, tag_count, reason_code, created_at FROM mail_auto_classification_events WHERE rule_id = %s ORDER BY created_at DESC, id DESC LIMIT 1", (row["id"],))
        event = cursor.fetchone()
        last = None if event is None else MailAutoClassificationLastEvent(result=event["result"], folderApplied=event["folder_applied"], tagCount=event["tag_count"], reasonCode=event["reason_code"], createdAt=event["created_at"])
        return MailAutoClassificationRuleView(ruleId=row["id"], name=row["name"], enabled=row["enabled"], priority=row["priority"], version=row["version"], conditions=conditions, targetFolderId=row["target_folder_id"], tagIds=tag_ids, lastEvent=last, createdAt=row["created_at"], updatedAt=row["updated_at"])

    def _normalized_conditions(self, values) -> list[dict]:
        return [{"field": item.field, "operator": item.operator, "value": normalize_condition_value(item.field, item.operator, item.value)} for item in values]

    @staticmethod
    def _lock_owner(cursor, company_id: str, user_id: str) -> None:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))", (company_id, user_id))

    def _assert_name(self, cursor, actor, name: str, exclude: str | None = None) -> None:
        sql = "SELECT id FROM mail_auto_classification_rules WHERE company_id = %s AND user_id = %s AND LOWER(name) = LOWER(%s)"
        params: tuple = (actor.companyId, actor.userId, name)
        if exclude: sql += " AND id <> %s"; params += (exclude,)
        cursor.execute(sql, params)
        if cursor.fetchone(): raise AutoClassificationConflictError("같은 이름의 규칙이 있습니다.")

    @staticmethod
    def _assert_targets(cursor, actor, folder_id: str | None, tag_ids: list[str]) -> None:
        if folder_id:
            cursor.execute("SELECT id FROM mail_user_folders WHERE id = %s AND company_id = %s AND user_id = %s", (folder_id, actor.companyId, actor.userId))
            if cursor.fetchone() is None: raise AutoClassificationTargetForbiddenError("대상 메일함에 접근할 수 없습니다.")
        if tag_ids:
            cursor.execute("SELECT id FROM mail_tags WHERE id = ANY(%s) AND company_id = %s AND user_id = %s", (tag_ids, actor.companyId, actor.userId))
            if {row["id"] for row in cursor.fetchall()} != set(tag_ids): raise AutoClassificationTargetForbiddenError("대상 태그에 접근할 수 없습니다.")

    def _replace_children(self, cursor, rule_id: str, conditions: list[dict], tag_ids: list[str]) -> None:
        cursor.execute("DELETE FROM mail_auto_classification_conditions WHERE rule_id = %s", (rule_id,))
        cursor.execute("DELETE FROM mail_auto_classification_rule_tags WHERE rule_id = %s", (rule_id,))
        for position, item in enumerate(conditions, 1):
            cursor.execute("INSERT INTO mail_auto_classification_conditions (id, rule_id, position, field, operator, value) VALUES (%s,%s,%s,%s,%s,%s)", (self._new_id("autocond"), rule_id, position, item["field"], item["operator"], item["value"]))
        for position, tag_id in enumerate(tag_ids, 1): cursor.execute("INSERT INTO mail_auto_classification_rule_tags (rule_id, tag_id, position) VALUES (%s,%s,%s)", (rule_id, tag_id, position))

    def _audit(self, cursor, company_id: str, actor_id: str, actor_name: str, target_id: str, event: str, summary: dict, now: datetime) -> None:
        cursor.execute("INSERT INTO audit_logs (id, company_id, actor_user_id, actor_user_name, target_type, target_id, event, status_before, status_after, reason, created_at) VALUES (%s,%s,%s,%s,'mail_auto_classification',%s,%s,NULL,'updated',%s,%s)", (self._new_id("audit"), company_id, actor_id, actor_name, target_id, event, json.dumps(summary, ensure_ascii=True, separators=(",", ":")), now))
