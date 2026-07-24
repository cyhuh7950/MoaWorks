from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
import logging
import uuid

from psycopg import Error as PsycopgError

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailAutoForwardExceptionCreateRequest, MailAutoForwardExceptionUpdateRequest,
    MailAutoForwardExceptionView, MailAutoForwardExceptionsDeleteRequest,
    MailAutoForwardLastResult, MailAutoForwardPolicyUpdateRequest,
    MailAutoForwardSettingsResponse, MailAutoForwardTargetView,
    MailAutoForwardTargetsCreateRequest, MailAutoForwardTargetsDeleteRequest,
)
from app.services.postgres_service import PostgresService


logger = logging.getLogger(__name__)


class AutoForwardConflictError(RuntimeError):
    pass


class AutoForwardPolicyConflictError(AutoForwardConflictError):
    pass


class AutoForwardLimitError(AutoForwardConflictError):
    pass


class AutoForwardSelfTargetError(ValueError):
    pass


class AutoForwardInvalidInternalTargetError(ValueError):
    pass


class AutoForwardTargetForbiddenError(PermissionError):
    pass


def normalize_forward_email(value: str) -> str:
    normalized = str(value).strip().lower()
    if len(normalized) > 254 or normalized.count("@") != 1:
        raise ValueError("이메일 주소를 확인해 주세요.")
    local, domain = normalized.rsplit("@", 1)
    if not local or not domain or any(character.isspace() for character in normalized):
        raise ValueError("이메일 주소를 확인해 주세요.")
    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("이메일 주소를 확인해 주세요.") from exc
    result = f"{local}@{ascii_domain}"
    if len(result) > 254 or "." not in ascii_domain:
        raise ValueError("이메일 주소를 확인해 주세요.")
    return result


def normalize_forward_domain(value: str) -> str:
    normalized = str(value).strip().lower().lstrip("@")
    if not normalized or "@" in normalized or len(normalized) > 253:
        raise ValueError("도메인을 확인해 주세요.")
    try:
        normalized = normalized.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("도메인을 확인해 주세요.") from exc
    if "." not in normalized:
        raise ValueError("도메인을 확인해 주세요.")
    return normalized


@dataclass(frozen=True)
class AutoForwardDecision:
    targetEmails: list[str]
    exceptionId: str | None = None

    @classmethod
    def from_rules(cls, defaults: list[str], rules: list[dict], sender_email: str) -> "AutoForwardDecision":
        sender = normalize_forward_email(sender_email)
        sender_domain = sender.rsplit("@", 1)[1]
        enabled = [rule for rule in rules if rule.get("enabled", True)]
        exact = [rule for rule in enabled if rule["matcher_type"] == "sender_email" and rule["matcher_value"] == sender]
        domains = [
            rule for rule in enabled
            if rule["matcher_type"] == "sender_domain"
            and (sender_domain == rule["matcher_value"] or sender_domain.endswith("." + rule["matcher_value"]))
        ]
        matched = exact[0] if exact else max(domains, key=lambda item: len(item["matcher_value"]), default=None)
        values = defaults if matched is None else ([] if matched["action"] == "skip" else matched.get("target_emails", []))
        result: list[str] = []
        for value in values:
            normalized = normalize_forward_email(value)
            if normalized not in result:
                result.append(normalized)
        return cls(result, None if matched is None else matched["id"])


class MailAutoForwardingService:
    MAX_TARGETS = 10
    MAX_EXCEPTIONS = 100

    def __init__(self, db=None):
        self.db = db or PostgresService()

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex}"

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    def get_settings(self, actor: AuthUserSummary) -> MailAutoForwardSettingsResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT enabled, keep_original, version, updated_at FROM mail_auto_forward_policies WHERE company_id = %s AND user_id = %s", (actor.companyId, actor.userId))
                policy = cursor.fetchone()
                cursor.execute("""SELECT t.id, t.normalized_email, t.target_kind,
                    d.status AS last_status, d.reason_code, d.created_at AS last_created_at
                    FROM mail_auto_forward_targets t LEFT JOIN LATERAL (
                      SELECT status, reason_code, created_at FROM mail_auto_forward_deliveries
                      WHERE company_id=t.company_id AND user_id=t.user_id AND target_email=t.normalized_email
                      ORDER BY created_at DESC, id DESC LIMIT 1
                    ) d ON TRUE WHERE t.company_id=%s AND t.user_id=%s ORDER BY t.position""", (actor.companyId, actor.userId))
                targets = [self._target_view(row) for row in cursor.fetchall()]
                cursor.execute("""SELECT e.id,e.matcher_type,e.matcher_value,e.action,e.enabled,e.version,e.created_at,e.updated_at,
                    d.status AS last_status,d.reason_code,d.created_at AS last_created_at
                    FROM mail_auto_forward_exceptions e LEFT JOIN LATERAL (
                      SELECT status,reason_code,created_at FROM mail_auto_forward_deliveries
                      WHERE exception_id=e.id ORDER BY created_at DESC,id DESC LIMIT 1
                    ) d ON TRUE WHERE e.company_id=%s AND e.user_id=%s ORDER BY e.created_at,e.id""", (actor.companyId, actor.userId))
                exception_rows = cursor.fetchall()
                ids = [row["id"] for row in exception_rows]
                exception_targets: dict[str, list[str]] = {item: [] for item in ids}
                if ids:
                    cursor.execute("SELECT exception_id,normalized_email FROM mail_auto_forward_exception_targets WHERE exception_id=ANY(%s) ORDER BY exception_id,position", (ids,))
                    for item in cursor.fetchall():
                        exception_targets[item["exception_id"]].append(item["normalized_email"])
                exceptions = [self._exception_view(row, exception_targets[row["id"]]) for row in exception_rows]
                cursor.execute("SELECT delivery_enabled,last_test_status FROM mail_provider_configs WHERE company_id=%s ORDER BY active DESC,updated_at DESC LIMIT 1", (actor.companyId,))
                provider = cursor.fetchone()
        return MailAutoForwardSettingsResponse(
            enabled=False if policy is None else policy["enabled"], keepOriginal=True if policy is None else policy["keep_original"],
            version=1 if policy is None else policy["version"], updatedAt=now if policy is None else policy["updated_at"],
            providerLocked=not bool(provider and provider["delivery_enabled"] and provider["last_test_status"] == "success"),
            targets=targets, exceptions=exceptions,
        )

    def update_policy(self, actor: AuthUserSummary, payload: MailAutoForwardPolicyUpdateRequest) -> MailAutoForwardSettingsResponse:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT id,version FROM mail_auto_forward_policies WHERE company_id=%s AND user_id=%s FOR UPDATE", (actor.companyId, actor.userId))
                row = cursor.fetchone()
                current = 1 if row is None else row["version"]
                if current != payload.version:
                    raise AutoForwardPolicyConflictError("다른 위치에서 정책이 변경되었습니다.")
                if row is None:
                    cursor.execute("INSERT INTO mail_auto_forward_policies(id,company_id,user_id,enabled,keep_original,version,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,2,%s,%s)", (self._new_id("forwardpolicy"), actor.companyId, actor.userId, payload.enabled, payload.keepOriginal, now, now))
                else:
                    cursor.execute("UPDATE mail_auto_forward_policies SET enabled=%s,keep_original=%s,version=version+1,updated_at=%s WHERE id=%s AND company_id=%s AND user_id=%s AND version=%s", (payload.enabled, payload.keepOriginal, now, row["id"], actor.companyId, actor.userId, payload.version))
                self._audit(cursor, actor, actor.userId, "mail.auto_forward.policy.updated", {"enabled": payload.enabled, "keepOriginal": payload.keepOriginal, "version": payload.version + 1}, now)
            connection.commit()
        return self.get_settings(actor)

    def create_targets(self, actor: AuthUserSummary, payload: MailAutoForwardTargetsCreateRequest) -> list[MailAutoForwardTargetView]:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT normalized_email FROM mail_auto_forward_targets WHERE company_id=%s AND user_id=%s", (actor.companyId, actor.userId))
                existing = {row["normalized_email"] for row in cursor.fetchall()}
                additions = [email for email in payload.emails if email not in existing]
                if len(existing) + len(additions) > self.MAX_TARGETS:
                    raise AutoForwardLimitError("자동전달 주소는 최대 10개입니다.")
                classified = self._classify_targets(cursor, actor, additions)
                cursor.execute("SELECT COALESCE(MAX(position),0) AS position FROM mail_auto_forward_targets WHERE company_id=%s AND user_id=%s", (actor.companyId, actor.userId))
                position = int(cursor.fetchone()["position"])
                for email, user_id, kind in classified:
                    position += 1
                    cursor.execute("INSERT INTO mail_auto_forward_targets(id,company_id,user_id,normalized_email,target_user_id,target_kind,position,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)", (self._new_id("forwardtarget"), actor.companyId, actor.userId, email, user_id, kind, position, now, now))
                self._audit(cursor, actor, actor.userId, "mail.auto_forward.targets.created", {"targetCount": len(classified)}, now)
            connection.commit()
        return self.get_settings(actor).targets

    def delete_targets(self, actor: AuthUserSummary, payload: MailAutoForwardTargetsDeleteRequest) -> None:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT id FROM mail_auto_forward_targets WHERE company_id=%s AND user_id=%s AND id=ANY(%s) FOR UPDATE", (actor.companyId, actor.userId, payload.targetIds))
                if {row["id"] for row in cursor.fetchall()} != set(payload.targetIds):
                    raise AutoForwardTargetForbiddenError("전달 대상에 접근할 수 없습니다.")
                cursor.execute("DELETE FROM mail_auto_forward_targets WHERE company_id=%s AND user_id=%s AND id=ANY(%s)", (actor.companyId, actor.userId, payload.targetIds))
                self._audit(cursor, actor, actor.userId, "mail.auto_forward.targets.deleted", {"targetCount": len(payload.targetIds)}, now)
            connection.commit()

    def create_exception(self, actor: AuthUserSummary, payload: MailAutoForwardExceptionCreateRequest) -> MailAutoForwardExceptionView:
        now = self._now(); exception_id = self._new_id("forwardexception"); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT COUNT(*) AS total FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s", (actor.companyId, actor.userId))
                if int(cursor.fetchone()["total"]) >= self.MAX_EXCEPTIONS:
                    raise AutoForwardLimitError("예외 규칙은 최대 100개입니다.")
                self._assert_matcher_unique(cursor, actor, payload.matcherType, payload.matcherValue)
                targets = self._classify_targets(cursor, actor, payload.targetEmails)
                cursor.execute("INSERT INTO mail_auto_forward_exceptions(id,company_id,user_id,matcher_type,matcher_value,action,enabled,version,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,1,%s,%s)", (exception_id, actor.companyId, actor.userId, payload.matcherType, payload.matcherValue, payload.action, payload.enabled, now, now))
                self._replace_exception_targets(cursor, exception_id, targets)
                self._audit(cursor, actor, exception_id, "mail.auto_forward.exception.created", {"action": payload.action, "enabled": payload.enabled, "targetCount": len(targets)}, now)
            connection.commit()
        return MailAutoForwardExceptionView(exceptionId=exception_id, matcherType=payload.matcherType, matcherValue=payload.matcherValue, action=payload.action, targetEmails=payload.targetEmails, enabled=payload.enabled, version=1, createdAt=now, updatedAt=now)

    def update_exception(self, actor: AuthUserSummary, exception_id: str, payload: MailAutoForwardExceptionUpdateRequest) -> MailAutoForwardExceptionView:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT created_at,version FROM mail_auto_forward_exceptions WHERE id=%s AND company_id=%s AND user_id=%s FOR UPDATE", (exception_id, actor.companyId, actor.userId))
                row = cursor.fetchone()
                if row is None:
                    raise AutoForwardTargetForbiddenError("예외 규칙에 접근할 수 없습니다.")
                if row["version"] != payload.version:
                    raise AutoForwardConflictError("다른 위치에서 예외 규칙이 변경되었습니다.")
                self._assert_matcher_unique(cursor, actor, payload.matcherType, payload.matcherValue, exception_id)
                targets = self._classify_targets(cursor, actor, payload.targetEmails)
                cursor.execute("UPDATE mail_auto_forward_exceptions SET matcher_type=%s,matcher_value=%s,action=%s,enabled=%s,version=version+1,updated_at=%s WHERE id=%s AND company_id=%s AND user_id=%s AND version=%s", (payload.matcherType, payload.matcherValue, payload.action, payload.enabled, now, exception_id, actor.companyId, actor.userId, payload.version))
                self._replace_exception_targets(cursor, exception_id, targets)
                self._audit(cursor, actor, exception_id, "mail.auto_forward.exception.updated", {"action": payload.action, "enabled": payload.enabled, "targetCount": len(targets), "version": payload.version + 1}, now)
            connection.commit()
        return MailAutoForwardExceptionView(exceptionId=exception_id, matcherType=payload.matcherType, matcherValue=payload.matcherValue, action=payload.action, targetEmails=payload.targetEmails, enabled=payload.enabled, version=payload.version + 1, createdAt=row["created_at"], updatedAt=now)

    def delete_exception(self, actor: AuthUserSummary, exception_id: str) -> None:
        self.delete_exceptions(actor, MailAutoForwardExceptionsDeleteRequest(exceptionIds=[exception_id]))

    def delete_exceptions(self, actor: AuthUserSummary, payload: MailAutoForwardExceptionsDeleteRequest) -> None:
        now = self._now(); self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self._lock_owner(cursor, actor.companyId, actor.userId)
                cursor.execute("SELECT id FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s AND id=ANY(%s) FOR UPDATE", (actor.companyId, actor.userId, payload.exceptionIds))
                if {row["id"] for row in cursor.fetchall()} != set(payload.exceptionIds):
                    raise AutoForwardTargetForbiddenError("예외 규칙에 접근할 수 없습니다.")
                cursor.execute("DELETE FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s AND id=ANY(%s)", (actor.companyId, actor.userId, payload.exceptionIds))
                self._audit(cursor, actor, actor.userId, "mail.auto_forward.exceptions.deleted", {"exceptionCount": len(payload.exceptionIds)}, now)
            connection.commit()

    def apply_recipient(self, cursor, *, company_id: str, user_id: str, actor_user_id: str, actor_user_name: str,
                        mail_id: str, recipient_id: str, sender_email: str, now: datetime, classify_internal=None) -> AutoForwardDecision:
        cursor.execute("SAVEPOINT auto_forwarding")
        try:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s),hashtext(%s))", (recipient_id, "auto_forwarding"))
            cursor.execute("SELECT enabled,keep_original FROM mail_auto_forward_policies WHERE company_id=%s AND user_id=%s", (company_id, user_id))
            policy = cursor.fetchone()
            if policy is None or not policy["enabled"]:
                cursor.execute("RELEASE SAVEPOINT auto_forwarding")
                return AutoForwardDecision([])
            cursor.execute("SELECT normalized_email,target_user_id,target_kind FROM mail_auto_forward_targets WHERE company_id=%s AND user_id=%s ORDER BY position", (company_id, user_id))
            defaults = [dict(row) for row in cursor.fetchall()]
            cursor.execute("SELECT id,matcher_type,matcher_value,action,enabled FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s ORDER BY id", (company_id, user_id))
            rules = [dict(row) for row in cursor.fetchall()]
            ids = [row["id"] for row in rules]
            targets_by_rule = {item: [] for item in ids}
            if ids:
                cursor.execute("SELECT exception_id,normalized_email,target_user_id,target_kind FROM mail_auto_forward_exception_targets WHERE exception_id=ANY(%s) ORDER BY exception_id,position", (ids,))
                for row in cursor.fetchall():
                    targets_by_rule[row["exception_id"]].append(dict(row))
            by_email = {item["normalized_email"]: item for item in defaults}
            for rule in rules:
                rule["target_emails"] = [item["normalized_email"] for item in targets_by_rule[rule["id"]]]
                for item in targets_by_rule[rule["id"]]: by_email[item["normalized_email"]] = item
            decision = AutoForwardDecision.from_rules([item["normalized_email"] for item in defaults], rules, sender_email)
            cursor.execute("SELECT target_email FROM mail_auto_forward_deliveries WHERE origin_recipient_id=%s", (recipient_id,))
            completed_targets = {row["target_email"] for row in cursor.fetchall()}
            decision = AutoForwardDecision([email for email in decision.targetEmails if email not in completed_targets], decision.exceptionId)
            cursor.execute("SELECT recipient_email FROM mail_recipients WHERE message_id=%s AND delivery_source='direct'", (mail_id,))
            direct_targets = {
                normalize_forward_email(row["recipient_email"])
                for row in cursor.fetchall()
                if row.get("recipient_email")
            }
            decision = AutoForwardDecision([email for email in decision.targetEmails if email not in direct_targets], decision.exceptionId)
            if not decision.targetEmails:
                cursor.execute("RELEASE SAVEPOINT auto_forwarding")
                return decision
            cursor.execute("SELECT a.id,a.email,a.provider_config_id,p.delivery_enabled,p.last_test_status FROM mail_accounts a JOIN mail_provider_configs p ON p.id=a.provider_config_id WHERE a.user_id=%s AND a.status='active' AND p.company_id=%s", (user_id, company_id))
            owner_account = cursor.fetchone()
            if owner_account is None:
                raise ValueError("자동전달 소유자의 메일 계정을 찾을 수 없습니다.")
            for email in decision.targetEmails:
                item = by_email[email]
                forwarded_recipient_id = self._new_id("rcpt")
                cursor.execute("""INSERT INTO mail_recipients(id,message_id,recipient_user_id,recipient_email,recipient_kind,is_read,is_starred,received_at,is_spam,spam_marked_at,delivery_source,auto_forward_owner_user_id,auto_forward_origin_recipient_id)
                    VALUES(%s,%s,%s,%s,'to',FALSE,FALSE,%s,FALSE,NULL,'auto_forward',%s,%s) ON CONFLICT DO NOTHING""", (forwarded_recipient_id, mail_id, item.get("target_user_id"), email, now if item["target_kind"] == "internal" else None, user_id, recipient_id))
                queue_id = None
                if item["target_kind"] == "internal":
                    status = "internal_delivered"; reason = "INTERNAL_DELIVERED"
                    if classify_internal:
                        classify_internal(item["target_user_id"], forwarded_recipient_id, email)
                else:
                    queue_id = self._new_id("delivery")
                    status = "queued" if owner_account["delivery_enabled"] and owner_account["last_test_status"] == "success" else "blocked"
                    reason = "PROVIDER_READY" if status == "queued" else "PROVIDER_LOCKED"
                    cursor.execute("""INSERT INTO mail_delivery_queue(id,company_id,provider_config_id,mail_id,recipient_id,status,attempt_count,next_attempt_at,created_at,updated_at,delivery_kind,sender_email_override,reply_to_email_override)
                        VALUES(%s,%s,%s,%s,%s,%s,0,%s,%s,%s,'auto_forward',%s,%s) ON CONFLICT(mail_id,recipient_id) DO NOTHING""", (queue_id, company_id, owner_account["provider_config_id"], mail_id, forwarded_recipient_id, status, now if status == "queued" else None, now, now, owner_account["email"], sender_email))
                cursor.execute("""INSERT INTO mail_auto_forward_deliveries(id,company_id,user_id,origin_mail_id,origin_recipient_id,exception_id,target_email,target_user_id,forwarded_recipient_id,delivery_queue_id,status,reason_code,created_at,updated_at,completed_at)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(origin_recipient_id,target_email) DO NOTHING""", (self._new_id("forwarddelivery"), company_id, user_id, mail_id, recipient_id, decision.exceptionId, email, item.get("target_user_id"), forwarded_recipient_id, queue_id, status, reason, now, now, now if status == "internal_delivered" else None))
            if not policy["keep_original"]:
                self.reconcile_original_retention(cursor, recipient_id, now)
            self._audit_raw(cursor, company_id, actor_user_id, actor_user_name, mail_id, "mail.auto_forward.applied", {"targetCount": len(decision.targetEmails), "exceptionId": decision.exceptionId}, now)
            cursor.execute("RELEASE SAVEPOINT auto_forwarding")
            return decision
        except Exception as evaluator_error:
            cursor.execute("ROLLBACK TO SAVEPOINT auto_forwarding")
            cursor.execute("RELEASE SAVEPOINT auto_forwarding")
            if isinstance(evaluator_error, PsycopgError):
                raise
            logger.error("Auto forwarding evaluator failed: company_id=%s user_id=%s mail_id=%s error=%s", company_id, user_id, mail_id, type(evaluator_error).__name__)
            return AutoForwardDecision([])

    @staticmethod
    def reconcile_original_retention(cursor, origin_recipient_id: str, now: datetime) -> None:
        cursor.execute("""UPDATE mail_recipients origin SET deleted_at=%s
            WHERE origin.id=%s AND origin.delivery_source='direct'
              AND EXISTS(SELECT 1 FROM mail_auto_forward_deliveries d WHERE d.origin_recipient_id=origin.id)
              AND NOT EXISTS(SELECT 1 FROM mail_auto_forward_deliveries d WHERE d.origin_recipient_id=origin.id AND d.status NOT IN ('internal_delivered','sent'))
              AND EXISTS(SELECT 1 FROM mail_auto_forward_policies p WHERE p.company_id=(SELECT company_id FROM mail_messages WHERE id=origin.message_id) AND p.user_id=origin.recipient_user_id AND p.keep_original=FALSE)""", (now, origin_recipient_id))

    def _classify_targets(self, cursor, actor: AuthUserSummary, emails: list[str]) -> list[tuple[str, str | None, str]]:
        if any(email == normalize_forward_email(actor.userEmail) for email in emails):
            raise AutoForwardSelfTargetError("자기 자신의 주소로 자동전달할 수 없습니다.")
        cursor.execute("SELECT domain FROM companies WHERE id=%s", (actor.companyId,))
        company = cursor.fetchone()
        company_domain = normalize_forward_domain(company["domain"])
        cursor.execute("SELECT id,LOWER(email) AS email FROM users WHERE company_id=%s AND status='active'", (actor.companyId,))
        active = {normalize_forward_email(row["email"]): row["id"] for row in cursor.fetchall()}
        result = []
        for email in emails:
            user_id = active.get(email)
            if email.rsplit("@", 1)[1] == company_domain and not user_id:
                raise AutoForwardInvalidInternalTargetError("같은 회사의 활성 사용자 주소가 아닙니다.")
            result.append((email, user_id, "internal" if user_id else "external"))
        return result

    @staticmethod
    def _replace_exception_targets(cursor, exception_id: str, targets: list[tuple[str, str | None, str]]) -> None:
        cursor.execute("DELETE FROM mail_auto_forward_exception_targets WHERE exception_id=%s", (exception_id,))
        for position, (email, user_id, kind) in enumerate(targets, 1):
            cursor.execute("INSERT INTO mail_auto_forward_exception_targets(exception_id,normalized_email,target_user_id,target_kind,position) VALUES(%s,%s,%s,%s,%s)", (exception_id, email, user_id, kind, position))

    @staticmethod
    def _lock_owner(cursor, company_id: str, user_id: str) -> None:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s),hashtext(%s))", (company_id, user_id))

    @staticmethod
    def _assert_matcher_unique(cursor, actor, matcher_type: str, matcher_value: str, exclude: str | None = None) -> None:
        cursor.execute("SELECT id FROM mail_auto_forward_exceptions WHERE company_id=%s AND user_id=%s AND matcher_type=%s AND matcher_value=%s AND (%s IS NULL OR id<>%s)", (actor.companyId, actor.userId, matcher_type, matcher_value, exclude, exclude))
        if cursor.fetchone():
            raise AutoForwardConflictError("같은 발신자 예외 규칙이 있습니다.")

    @staticmethod
    def _last_result(row) -> MailAutoForwardLastResult | None:
        if not row.get("last_status"):
            return None
        return MailAutoForwardLastResult(status=row["last_status"], reasonCode=row["reason_code"], createdAt=row["last_created_at"])

    def _target_view(self, row) -> MailAutoForwardTargetView:
        return MailAutoForwardTargetView(targetId=row["id"], email=row["normalized_email"], targetKind=row["target_kind"], lastResult=self._last_result(row))

    def _exception_view(self, row, targets: list[str]) -> MailAutoForwardExceptionView:
        return MailAutoForwardExceptionView(exceptionId=row["id"], matcherType=row["matcher_type"], matcherValue=row["matcher_value"], action=row["action"], targetEmails=targets, enabled=row["enabled"], version=row["version"], lastResult=self._last_result(row), createdAt=row["created_at"], updatedAt=row["updated_at"])

    def _audit(self, cursor, actor, target_id: str, event: str, summary: dict, now: datetime) -> None:
        self._audit_raw(cursor, actor.companyId, actor.userId, actor.userName, target_id, event, summary, now)

    def _audit_raw(self, cursor, company_id: str, actor_id: str, actor_name: str, target_id: str, event: str, summary: dict, now: datetime) -> None:
        cursor.execute("INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at) VALUES(%s,%s,%s,%s,'mail_auto_forwarding',%s,%s,NULL,'updated',%s,%s)", (self._new_id("audit"), company_id, actor_id, actor_name, target_id, event, json.dumps(summary, ensure_ascii=True, separators=(",", ":")), now))
