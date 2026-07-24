from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import re
import uuid

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailSpamPolicyUpdateRequest,
    MailSpamRuleCreateRequest,
    MailSpamRuleUpdateRequest,
    MailSpamRuleView,
    MailSpamSettingsResponse,
)
from app.services.postgres_service import PostgresService


_LOCAL_PART = re.compile(r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*", re.IGNORECASE)
_ASCII_DOMAIN_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", re.IGNORECASE)


class SpamSettingsConflictError(RuntimeError):
    pass


class SpamRuleConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class SpamDecision:
    decision: str
    matchedRuleId: str | None = None
    matchedRuleType: str | None = None
    matchedMatchType: str | None = None


def normalize_spam_domain(value: str) -> str:
    candidate = value.strip()
    if candidate.startswith("@"):
        candidate = candidate[1:]
    if not candidate or any(character.isspace() for character in candidate):
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    if any(token in candidate for token in ("*", "://", "/", "\\", ":")):
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    if candidate.startswith(".") or candidate.endswith(".") or ".." in candidate:
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    try:
        normalized = candidate.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("도메인 형식이 올바르지 않습니다.") from exc
    labels = normalized.split(".")
    if len(labels) < 2 or len(normalized) > 253 or any(not _ASCII_DOMAIN_LABEL.fullmatch(label) for label in labels):
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    return normalized


def normalize_spam_email(value: str) -> str:
    candidate = value.strip()
    if candidate.count("@") != 1 or any(character.isspace() for character in candidate) or any(token in candidate for token in ("<", ">")):
        raise ValueError("이메일 형식이 올바르지 않습니다.")
    local, domain = candidate.split("@", 1)
    local = local.casefold()
    if len(local) > 64 or not _LOCAL_PART.fullmatch(local):
        raise ValueError("이메일 형식이 올바르지 않습니다.")
    normalized = f"{local}@{normalize_spam_domain(domain)}"
    if len(normalized) > 320:
        raise ValueError("이메일 형식이 올바르지 않습니다.")
    return normalized


def domain_matches(sender_domain: str, rule_domain: str) -> bool:
    return sender_domain == rule_domain or sender_domain.endswith(f".{rule_domain}")


class SpamSettingsService:
    MAX_RULES = 200

    def __init__(self) -> None:
        self.db = PostgresService()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex}"

    def get_settings(self, actor: AuthUserSummary) -> MailSpamSettingsResponse:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT filter_enabled, blocked_action, version, updated_at FROM user_spam_policies WHERE company_id = %s AND user_id = %s",
                    (actor.companyId, actor.userId),
                )
                policy = cursor.fetchone()
                cursor.execute(
                    """SELECT id, rule_type, match_type, match_value, enabled, created_at, updated_at
                       FROM user_spam_rules WHERE company_id = %s AND user_id = %s
                       ORDER BY created_at DESC, id DESC""",
                    (actor.companyId, actor.userId),
                )
                rules = cursor.fetchall()
        now = self._now()
        return MailSpamSettingsResponse(
            filterEnabled=True if policy is None else policy["filter_enabled"],
            blockedAction="move_to_spam" if policy is None else policy["blocked_action"],
            version=1 if policy is None else policy["version"],
            updatedAt=now if policy is None else policy["updated_at"],
            rules=[self._to_rule(row) for row in rules],
        )

    def update_policy(self, actor: AuthUserSummary, payload: MailSpamPolicyUpdateRequest) -> MailSpamSettingsResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id, version FROM user_spam_policies WHERE company_id = %s AND user_id = %s FOR UPDATE",
                    (actor.companyId, actor.userId),
                )
                current = cursor.fetchone()
                if current is None:
                    if payload.expectedVersion != 1:
                        raise SpamSettingsConflictError("다른 위치에서 스팸 설정이 변경되었습니다.")
                    policy_id = self._new_id("spampolicy")
                    cursor.execute(
                        """INSERT INTO user_spam_policies
                           (id, company_id, user_id, filter_enabled, blocked_action, version, created_at, updated_at)
                           VALUES (%s,%s,%s,%s,%s,2,%s,%s)""",
                        (policy_id, actor.companyId, actor.userId, payload.filterEnabled, payload.blockedAction, now, now),
                    )
                else:
                    if current["version"] != payload.expectedVersion:
                        raise SpamSettingsConflictError("다른 위치에서 스팸 설정이 변경되었습니다.")
                    cursor.execute(
                        """UPDATE user_spam_policies SET filter_enabled = %s, blocked_action = %s,
                           version = version + 1, updated_at = %s
                           WHERE id = %s AND company_id = %s AND user_id = %s AND version = %s""",
                        (payload.filterEnabled, payload.blockedAction, now, current["id"], actor.companyId, actor.userId, payload.expectedVersion),
                    )
                self._audit(cursor, actor, actor.userId, "mail.spam.policy.updated", "filterEnabled,blockedAction", now)
            connection.commit()
        return self.get_settings(actor)

    def create_rule(self, actor: AuthUserSummary, payload: MailSpamRuleCreateRequest) -> MailSpamRuleView:
        self.db.ensure_migrations_applied()
        normalized = self._normalize_rule(payload.matchType, payload.matchValue)
        now = self._now()
        rule_id = self._new_id("spamrule")
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor)
                self._assert_rule_available(cursor, actor, payload.matchType, normalized)
                cursor.execute("SELECT COUNT(*) AS total FROM user_spam_rules WHERE company_id = %s AND user_id = %s", (actor.companyId, actor.userId))
                if cursor.fetchone()["total"] >= self.MAX_RULES:
                    raise ValueError("스팸 규칙은 최대 200개까지 등록할 수 있습니다.")
                cursor.execute(
                    """INSERT INTO user_spam_rules
                       (id, company_id, user_id, rule_type, match_type, match_value, enabled, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (rule_id, actor.companyId, actor.userId, payload.ruleType, payload.matchType, normalized, payload.enabled, now, now),
                )
                self._audit(cursor, actor, rule_id, "mail.spam.rule.created", "ruleType,matchType,enabled", now)
            connection.commit()
        return MailSpamRuleView(ruleId=rule_id, ruleType=payload.ruleType, matchType=payload.matchType, matchValue=normalized, enabled=payload.enabled, createdAt=now, updatedAt=now)

    def update_rule(self, actor: AuthUserSummary, rule_id: str, payload: MailSpamRuleUpdateRequest) -> MailSpamRuleView:
        self.db.ensure_migrations_applied()
        normalized = self._normalize_rule(payload.matchType, payload.matchValue)
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor)
                cursor.execute("SELECT * FROM user_spam_rules WHERE id = %s AND company_id = %s AND user_id = %s FOR UPDATE", (rule_id, actor.companyId, actor.userId))
                current = cursor.fetchone()
                if current is None:
                    raise PermissionError("수정할 스팸 규칙에 접근할 수 없습니다.")
                self._assert_rule_available(cursor, actor, payload.matchType, normalized, exclude_rule_id=rule_id)
                cursor.execute(
                    """UPDATE user_spam_rules SET rule_type = %s, match_type = %s, match_value = %s,
                       enabled = %s, updated_at = %s WHERE id = %s AND company_id = %s AND user_id = %s""",
                    (payload.ruleType, payload.matchType, normalized, payload.enabled, now, rule_id, actor.companyId, actor.userId),
                )
                self._audit(cursor, actor, rule_id, "mail.spam.rule.updated", "ruleType,matchType,enabled", now)
            connection.commit()
        return MailSpamRuleView(ruleId=rule_id, ruleType=payload.ruleType, matchType=payload.matchType, matchValue=normalized, enabled=payload.enabled, createdAt=current["created_at"], updatedAt=now)

    def delete_rule(self, actor: AuthUserSummary, rule_id: str) -> None:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT id FROM user_spam_rules WHERE id = %s AND company_id = %s AND user_id = %s FOR UPDATE", (rule_id, actor.companyId, actor.userId))
                if cursor.fetchone() is None:
                    raise PermissionError("삭제할 스팸 규칙에 접근할 수 없습니다.")
                cursor.execute("DELETE FROM user_spam_rules WHERE id = %s AND company_id = %s AND user_id = %s", (rule_id, actor.companyId, actor.userId))
                self._audit(cursor, actor, rule_id, "mail.spam.rule.deleted", "deleted", now)
            connection.commit()

    def evaluate_sender(self, cursor, company_id: str, recipient_user_id: str, sender_email: str) -> SpamDecision:
        normalized_email = normalize_spam_email(sender_email)
        sender_domain = normalized_email.rsplit("@", 1)[1]
        cursor.execute("SELECT filter_enabled FROM user_spam_policies WHERE company_id = %s AND user_id = %s", (company_id, recipient_user_id))
        policy = cursor.fetchone()
        if policy is not None and not policy["filter_enabled"]:
            return SpamDecision("inbox")
        cursor.execute(
            """SELECT id, rule_type, match_type, match_value FROM user_spam_rules
               WHERE company_id = %s AND user_id = %s AND enabled = TRUE""",
            (company_id, recipient_user_id),
        )
        rules = cursor.fetchall()
        priorities = (("allow", "email"), ("allow", "domain"), ("deny", "email"), ("deny", "domain"))
        for rule_type, match_type in priorities:
            for rule in rules:
                if rule["rule_type"] != rule_type or rule["match_type"] != match_type:
                    continue
                matched = normalized_email == rule["match_value"] if match_type == "email" else domain_matches(sender_domain, rule["match_value"])
                if matched:
                    return SpamDecision("inbox" if rule_type == "allow" else "spam", rule["id"], rule_type, match_type)
        return SpamDecision("inbox")

    @staticmethod
    def _normalize_rule(match_type: str, value: str) -> str:
        return normalize_spam_email(value) if match_type == "email" else normalize_spam_domain(value)

    @staticmethod
    def _lock_owner(cursor, actor: AuthUserSummary) -> None:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))", (actor.companyId, actor.userId))

    @staticmethod
    def _assert_rule_available(cursor, actor: AuthUserSummary, match_type: str, match_value: str, exclude_rule_id: str | None = None) -> None:
        sql = "SELECT id FROM user_spam_rules WHERE company_id = %s AND user_id = %s AND match_type = %s AND match_value = %s"
        params: tuple = (actor.companyId, actor.userId, match_type, match_value)
        if exclude_rule_id:
            sql += " AND id <> %s"
            params += (exclude_rule_id,)
        cursor.execute(sql, params)
        if cursor.fetchone() is not None:
            raise SpamRuleConflictError("같은 이메일 또는 도메인 규칙이 이미 등록되어 있습니다.")

    @staticmethod
    def _to_rule(row: dict) -> MailSpamRuleView:
        return MailSpamRuleView(ruleId=row["id"], ruleType=row["rule_type"], matchType=row["match_type"], matchValue=row["match_value"], enabled=row["enabled"], createdAt=row["created_at"], updatedAt=row["updated_at"])

    def _audit(self, cursor, actor: AuthUserSummary, target_id: str, event: str, changed_fields: str, now: datetime) -> None:
        cursor.execute(
            """INSERT INTO audit_logs
               (id, company_id, actor_user_id, actor_user_name, target_type, target_id, event, status_before, status_after, reason, created_at)
               VALUES (%s,%s,%s,%s,'mail_spam_setting',%s,%s,NULL,'updated',%s,%s)""",
            (self._new_id("audit"), actor.companyId, actor.userId, actor.userName, target_id, event, changed_fields, now),
        )
