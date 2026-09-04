from __future__ import annotations

from app.services.outbound_provider_resolver import OutboundProviderResolver

from datetime import UTC, date, datetime, timedelta
import json
import logging
import uuid
from zoneinfo import ZoneInfo

from psycopg import Error as PsycopgError

from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import (
    MailOutOfOfficeLastResult,
    MailOutOfOfficePolicyUpdateRequest,
    MailOutOfOfficeSettingsResponse,
)
from app.services.postgres_service import PostgresService


logger = logging.getLogger(__name__)
SEOUL = ZoneInfo("Asia/Seoul")


class MailOutOfOfficePolicyConflictError(RuntimeError):
    pass


class OutOfOfficeInvalidPeriodError(ValueError):
    pass


class OutOfOfficeRequiredContentError(ValueError):
    pass


class OutOfOfficeTargetForbiddenError(PermissionError):
    pass


def normalize_out_of_office_email(value: str) -> str:
    normalized = str(value).strip().lower()
    if len(normalized) > 254 or normalized.count("@") != 1:
        raise ValueError("이메일 주소를 확인해 주세요.")
    local, domain = normalized.rsplit("@", 1)
    if not local or not domain or any(character.isspace() for character in normalized):
        raise ValueError("이메일 주소를 확인해 주세요.")
    try:
        domain = domain.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("이메일 주소를 확인해 주세요.") from exc
    result = f"{local}@{domain}"
    if len(result) > 254 or "." not in domain:
        raise ValueError("이메일 주소를 확인해 주세요.")
    return result


def compute_out_of_office_state(enabled: bool, start: date | None, end: date | None, today: date) -> str:
    if not enabled:
        return "disabled"
    if start is None or end is None:
        return "disabled"
    if today < start:
        return "scheduled"
    if today > end:
        return "expired"
    return "active"


def should_suppress_out_of_office(sender_email: str, owner_email: str, is_auto_generated: bool) -> bool:
    sender = normalize_out_of_office_email(sender_email)
    owner = normalize_out_of_office_email(owner_email)
    local = sender.rsplit("@", 1)[0].replace("_", "-").replace(".", "-")
    return is_auto_generated or sender == owner or local in {
        "mailer-daemon", "postmaster", "no-reply", "noreply", "do-not-reply", "donotreply"
    }


def classify_out_of_office_sender(
    sender_email: str, active_users: dict[str, str], company_domain: str,
) -> tuple[str, str | None]:
    sender = normalize_out_of_office_email(sender_email)
    normalized_active = {normalize_out_of_office_email(email): user_id for email, user_id in active_users.items()}
    user_id = normalized_active.get(sender)
    if user_id:
        return "internal", user_id
    domain = str(company_domain).strip().lower().lstrip("@").encode("idna").decode("ascii")
    if sender.rsplit("@", 1)[1] == domain:
        return "suppressed", None
    return "external", None


class MailOutOfOfficeService:
    def __init__(self, db=None):
        self.db = db or PostgresService()

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex}"

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _today(now: datetime) -> date:
        return now.astimezone(SEOUL).date()

    @staticmethod
    def _validate_policy(payload: MailOutOfOfficePolicyUpdateRequest) -> None:
        if (payload.startDate is None) != (payload.endDate is None):
            raise OutOfOfficeInvalidPeriodError("부재 기간을 확인해 주세요.")
        if payload.startDate is not None and payload.endDate is not None:
            if payload.startDate > payload.endDate:
                raise OutOfOfficeInvalidPeriodError("부재 기간을 확인해 주세요.")
            if (payload.endDate - payload.startDate).days > 364:
                raise OutOfOfficeInvalidPeriodError("부재 기간은 최대 365일입니다.")
        if payload.enabled and payload.startDate is None:
            raise OutOfOfficeInvalidPeriodError("부재 기간을 확인해 주세요.")
        if payload.enabled and (not payload.subject.strip() or not payload.message.strip()):
            raise OutOfOfficeRequiredContentError("응답 제목과 메시지를 입력해 주세요.")

    def get_settings(self, actor: AuthUserSummary) -> MailOutOfOfficeSettingsResponse:
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT enabled,start_date,end_date,subject,message_text,target_scope,version,updated_at "
                    "FROM mail_out_of_office_policies WHERE company_id=%s AND user_id=%s",
                    (actor.companyId, actor.userId),
                )
                policy = cursor.fetchone()
                cursor.execute(
                    "SELECT status,reason_code,created_at FROM mail_out_of_office_deliveries "
                    "WHERE company_id=%s AND user_id=%s ORDER BY created_at DESC,id DESC LIMIT 1",
                    (actor.companyId, actor.userId),
                )
                last = cursor.fetchone()
                cursor.execute(
                    "SELECT COUNT(*) AS total FROM mail_out_of_office_deliveries WHERE company_id=%s AND user_id=%s",
                    (actor.companyId, actor.userId),
                )
                total = cursor.fetchone()
                provider = OutboundProviderResolver.readiness(cursor, actor.companyId)
        enabled = False if policy is None else policy["enabled"]
        start = None if policy is None else policy["start_date"]
        end = None if policy is None else policy["end_date"]
        return MailOutOfOfficeSettingsResponse(
            enabled=enabled, startDate=start, endDate=end,
            subject="" if policy is None else policy["subject"],
            message="" if policy is None else policy["message_text"],
            targetScope="all" if policy is None else policy["target_scope"],
            version=1 if policy is None else policy["version"],
            state=compute_out_of_office_state(enabled, start, end, self._today(now)),
            lastResult=None if last is None else MailOutOfOfficeLastResult(
                status=last["status"], reasonCode=last["reason_code"], createdAt=last["created_at"]
            ),
            responseCount=0 if total is None else int(total["total"]),
            providerLocked=not bool(provider and provider["delivery_enabled"] and provider["last_test_status"] == "success"),
            updatedAt=now if policy is None else policy["updated_at"],
        )

    def update_policy(self, actor: AuthUserSummary, payload: MailOutOfOfficePolicyUpdateRequest) -> MailOutOfOfficeSettingsResponse:
        self._validate_policy(payload)
        self.db.ensure_migrations_applied()
        now = self._now()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s),hashtext(%s))", (actor.companyId, actor.userId))
                cursor.execute(
                    "SELECT id,version FROM mail_out_of_office_policies WHERE company_id=%s AND user_id=%s FOR UPDATE",
                    (actor.companyId, actor.userId),
                )
                row = cursor.fetchone()
                current = 1 if row is None else row["version"]
                if current != payload.version:
                    raise MailOutOfOfficePolicyConflictError("다른 위치에서 정책이 변경되었습니다.")
                if row is None:
                    cursor.execute(
                        "INSERT INTO mail_out_of_office_policies(id,company_id,user_id,enabled,start_date,end_date,subject,message_text,target_scope,version,created_at,updated_at) "
                        "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,2,%s,%s)",
                        (self._new_id("ooopolicy"), actor.companyId, actor.userId, payload.enabled, payload.startDate,
                         payload.endDate, payload.subject.strip(), payload.message.strip(), payload.targetScope, now, now),
                    )
                else:
                    cursor.execute(
                        "UPDATE mail_out_of_office_policies SET enabled=%s,start_date=%s,end_date=%s,subject=%s,message_text=%s,target_scope=%s,version=version+1,updated_at=%s "
                        "WHERE id=%s AND company_id=%s AND user_id=%s AND version=%s",
                        (payload.enabled, payload.startDate, payload.endDate, payload.subject.strip(), payload.message.strip(),
                         payload.targetScope, now, row["id"], actor.companyId, actor.userId, payload.version),
                    )
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, actor.userId,
                            "mail.out_of_office.policy.updated", {"enabled": payload.enabled, "targetScope": payload.targetScope}, now)
            connection.commit()
        return self.get_settings(actor)

    def apply_recipient(
        self, cursor, *, company_id: str, user_id: str, actor_user_id: str, actor_user_name: str,
        mail_id: str, recipient_id: str, sender_email: str, delivery_source: str,
        is_auto_generated: bool, is_spam: bool, now: datetime,
    ) -> str | None:
        if delivery_source != "direct" or is_spam:
            return None
        cursor.execute("SAVEPOINT out_of_office")
        try:
            cursor.execute(
                "SELECT p.id,p.enabled,p.start_date,p.end_date,p.subject,p.message_text,p.target_scope "
                "FROM mail_out_of_office_policies p WHERE p.company_id=%s AND p.user_id=%s FOR UPDATE",
                (company_id, user_id),
            )
            policy = cursor.fetchone()
            if not policy or compute_out_of_office_state(policy["enabled"], policy["start_date"], policy["end_date"], self._today(now)) != "active":
                cursor.execute("RELEASE SAVEPOINT out_of_office")
                return None
            cursor.execute(
                "SELECT a.id,a.email FROM mail_accounts a JOIN users u ON u.id=a.user_id "
                "WHERE a.user_id=%s AND a.status='active' AND u.company_id=%s ORDER BY a.created_at LIMIT 1",
                (user_id, company_id),
            )
            owner = cursor.fetchone()
            if owner is None or should_suppress_out_of_office(sender_email, owner["email"], is_auto_generated):
                cursor.execute("RELEASE SAVEPOINT out_of_office")
                return None
            cursor.execute("SELECT domain FROM companies WHERE id=%s", (company_id,))
            company = cursor.fetchone()
            cursor.execute("SELECT id,LOWER(email) AS email FROM users WHERE company_id=%s AND status='active'", (company_id,))
            active = {row["email"]: row["id"] for row in cursor.fetchall()}
            target_kind, target_user_id = classify_out_of_office_sender(sender_email, active, company["domain"])
            if target_kind == "suppressed" or (policy["target_scope"] != "all" and policy["target_scope"] != target_kind):
                cursor.execute("RELEASE SAVEPOINT out_of_office")
                return None
            normalized_sender = normalize_out_of_office_email(sender_email)
            delivery_id = self._new_id("ooodlv")
            cursor.execute(
                "INSERT INTO mail_out_of_office_deliveries(id,company_id,user_id,policy_id,period_start,period_end,normalized_sender_email,origin_mail_id,origin_recipient_id,target_kind,status,reason_code,created_at,updated_at) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'blocked','RESERVED',%s,%s) "
                "ON CONFLICT(policy_id,period_start,period_end,normalized_sender_email) DO NOTHING RETURNING id",
                (delivery_id, company_id, user_id, policy["id"], policy["start_date"], policy["end_date"],
                 normalized_sender, mail_id, recipient_id, target_kind, now, now),
            )
            if cursor.fetchone() is None:
                cursor.execute("RELEASE SAVEPOINT out_of_office")
                return "duplicate"
            response_mail_id = self._new_id("mail")
            response_recipient_id = self._new_id("rcpt")
            cursor.execute(
                "INSERT INTO mail_messages(id,company_id,sender_user_id,sender_account_id,sender_email,subject,body_text,body_html,status,sent_at,created_at,updated_at,retention_expires_at,attachment_count,source_message_id,source_action,sender_display_name,reply_to_email,message_encoding,sender_copy_saved,read_receipt_requested,is_auto_generated) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,NULL,'sent',%s,%s,%s,%s,0,%s,'out_of_office','',NULL,'utf-8',FALSE,FALSE,TRUE)",
                (response_mail_id, company_id, user_id, owner["id"], owner["email"], policy["subject"],
                 policy["message_text"], now, now, now, now + timedelta(days=30), mail_id),
            )
            cursor.execute(
                "INSERT INTO mail_recipients(id,message_id,recipient_user_id,recipient_email,recipient_kind,is_read,is_starred,received_at,is_spam,spam_marked_at,delivery_source) "
                "VALUES(%s,%s,%s,%s,'to',FALSE,FALSE,%s,FALSE,NULL,'out_of_office')",
                (response_recipient_id, response_mail_id, target_user_id, normalized_sender, now if target_kind == "internal" else None),
            )
            queue_id = None
            if target_kind == "internal":
                status, reason, completed = "internal_delivered", "INTERNAL_DELIVERED", now
            else:
                queue_id = self._new_id("delivery")
                provider = OutboundProviderResolver.resolve(cursor, company_id)
                status = "queued" if provider["delivery_enabled"] and provider["last_test_status"] == "success" else "blocked"
                reason = "PROVIDER_READY" if status == "queued" else "PROVIDER_LOCKED"
                completed = None
                cursor.execute(
                    "INSERT INTO mail_delivery_queue(id,company_id,provider_config_id,mail_id,recipient_id,status,attempt_count,next_attempt_at,created_at,updated_at,delivery_kind,sender_email_override) "
                    "VALUES(%s,%s,%s,%s,%s,%s,0,%s,%s,%s,'out_of_office',%s) ON CONFLICT(mail_id,recipient_id) DO NOTHING",
                    (queue_id, company_id, provider["id"], response_mail_id, response_recipient_id,
                     status, now if status == "queued" else None, now, now, owner["email"]),
                )
            cursor.execute(
                "UPDATE mail_out_of_office_deliveries SET response_mail_id=%s,response_recipient_id=%s,delivery_queue_id=%s,status=%s,reason_code=%s,updated_at=%s,completed_at=%s WHERE id=%s",
                (response_mail_id, response_recipient_id, queue_id, status, reason, now, completed, delivery_id),
            )
            self._audit(cursor, company_id, user_id, "system", delivery_id,
                        "mail.out_of_office.applied", {"targetKind": target_kind, "status": status}, now)
            cursor.execute("RELEASE SAVEPOINT out_of_office")
            return status
        except Exception as evaluator_error:
            cursor.execute("ROLLBACK TO SAVEPOINT out_of_office")
            cursor.execute("RELEASE SAVEPOINT out_of_office")
            if isinstance(evaluator_error, PsycopgError):
                raise
            logger.error(
                "Out-of-office evaluator failed: company_id=%s user_id=%s mail_id=%s error=%s",
                company_id, user_id, mail_id, type(evaluator_error).__name__,
            )
            return None

    @staticmethod
    def _audit(cursor, company_id: str, actor_id: str, actor_name: str, target_id: str, event: str, summary: dict, now: datetime) -> None:
        cursor.execute(
            "INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at) "
            "VALUES(%s,%s,%s,%s,'mail_out_of_office',%s,%s,NULL,'updated',%s,%s)",
            (f"audit_{uuid.uuid4().hex}", company_id, actor_id, actor_name, target_id, event,
             json.dumps(summary, ensure_ascii=True, separators=(",", ":")), now),
        )
