from __future__ import annotations

import base64
import re

from datetime import UTC, datetime
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import settings
from app.schemas.mail_operations import MailDailySendUsage
from app.services.mail_daily_send_quota import (
    MailDailyQuotaUnavailable,
    MailDailySendLimitExceeded,
    MailDailySendQuota,
)
from app.services.mail_operations_policy import build_mail_domain_contract
from app.services.mail_operations_service import MailOperationsService
from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.mail_delivery_service import mask_delivery_error
from app.services.oci_email_operations import OciEmailOperations
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService


_PROVIDER_TYPES = {
    "self_hosted": ("self_hosted", "self_hosted_smtp", "smtp"),
    "oci_email_delivery": ("oci_email_delivery", "oci_smtp"),
}
def generate_dkim_keypair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    dns_value = "v=DKIM1; k=rsa; p=" + base64.b64encode(public_der).decode("ascii")
    return private_pem, dns_value




class MailAdminOperations:
    def __init__(self, db=None, oci_operations: OciEmailOperations | None = None, delivery_adapter=None, quota=None) -> None:
        self.db = db or PostgresService()
        self.policy = MailOperationsService()
        self.security = SecurityService()
        self.oci_operations = oci_operations or OciEmailOperations()
        self.delivery_adapter = delivery_adapter or MailDeliveryOperations().adapter
        self.quota = quota or MailDailySendQuota(
            self.db,
            limit=settings.mail_engine_daily_send_limit,
        )

    @staticmethod
    def _provider_key(provider_type: str) -> str:
        return "oci_email_delivery" if provider_type in _PROVIDER_TYPES["oci_email_delivery"] else "self_hosted"

    @staticmethod
    def _provider_view(row: dict) -> dict:
        return {
            "providerId": row["id"],
            "providerKey": MailAdminOperations._provider_key(row["provider_type"]),
            "active": bool(row.get("active")),
            "deliveryEnabled": bool(row.get("delivery_enabled")),
            "relayHost": row.get("relay_host", ""),
            "relayPort": row.get("relay_port", 0),
            "tlsMode": row.get("tls_mode", "none"),
            "senderAddress": row.get("from_address"),
            "usernameConfigured": bool(row.get("username")),
            "passwordConfigured": bool(row.get("encrypted_password")),
            "dkimDomain": row.get("dkim_domain"),
            "dkimSelector": row.get("dkim_selector"),
            "dkimPrivateKeyConfigured": bool(row.get("encrypted_dkim_private_key")),
            "lastTestStatus": row.get("last_test_status", "untested"),
            "lastConnectionAt": row.get("last_connection_at"),
            "lastConnectionError": row.get("last_connection_error"),
        }

    def get_overview(self, actor) -> dict:
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                domain = cursor.fetchone()
                cursor.execute("SELECT * FROM mail_provider_configs WHERE company_id=%s ORDER BY active DESC,updated_at DESC", (actor.companyId,))
                providers = cursor.fetchall()
                cursor.execute("SELECT status,COUNT(*) AS count FROM mail_delivery_queue WHERE company_id=%s GROUP BY status", (actor.companyId,))
                queue = {row["status"]: int(row["count"]) for row in cursor.fetchall()}
                cursor.execute(
                    """SELECT COUNT(*) AS count,
                    COALESCE(
                        MAX(s.last_seen_at),
                        (SELECT MAX(a.created_at) FROM audit_logs a
                         WHERE a.company_id=%s AND a.event='mail.oci_suppression.synced')
                    ) AS last_seen_at
                    FROM mail_oci_suppressions s
                    WHERE s.company_id=%s AND s.active=TRUE""",
                    (actor.companyId, actor.companyId),
                )
                suppression = cursor.fetchone() or {"count": 0, "last_seen_at": None}
                cursor.execute("SELECT COUNT(*) AS count FROM mail_delivery_feedback f JOIN mail_delivery_queue q ON q.id=f.queue_id WHERE q.company_id=%s", (actor.companyId,))
                feedback = cursor.fetchone() or {"count": 0}
                cursor.execute(
                    """WITH quota_clock AS (
                        SELECT
                            timezone('Asia/Seoul', statement_timestamp())::date AS usage_date,
                            (
                                (
                                    timezone('Asia/Seoul', statement_timestamp())::date + 1
                                )::timestamp AT TIME ZONE 'Asia/Seoul'
                            ) AS reset_at
                    )
                    SELECT
                        COALESCE(usage.attempt_count, 0) AS used,
                        quota_clock.reset_at
                    FROM quota_clock
                    LEFT JOIN mail_engine_daily_send_usage usage
                        ON usage.usage_date = quota_clock.usage_date"""
                )
                usage = cursor.fetchone()
                if usage is None:
                    raise ValueError("메일 일일 발송 사용량을 조회할 수 없습니다.")
        domain_view = None
        if domain:
            domain_view = {
                "registeredDomain": domain["registered_domain"],
                "mailDomain": domain["mail_domain"],
                "userHost": domain["user_host"],
                "adminHost": domain["admin_host"],
                "mailHost": domain["mail_host"],
                "inboundMxHost": domain.get("inbound_mx_host") or domain["mail_host"],
                "adminAccessMode": domain["admin_access_mode"],
                "adminAllowedCidrs": list(domain.get("admin_allowed_cidrs") or []),
                "activeOutboundProvider": domain["active_outbound_provider_key"],
                "previousOutboundProvider": domain.get("previous_outbound_provider_key"),
                "providerSwitchedAt": domain.get("provider_switched_at"),
            }
        limit = settings.mail_engine_daily_send_limit
        used = int(usage["used"])
        daily_send_usage = MailDailySendUsage(
            used=used,
            limit=limit,
            unlimited=limit == 0,
            remaining=None if limit == 0 else max(0, limit - used),
            resetAt=usage["reset_at"],
        ).model_dump(mode="json")
        return {
            "domain": domain_view,
            "providers": [self._provider_view(dict(row)) for row in providers],
            "queue": queue,
            "feedbackCount": int(feedback["count"]),
            "ociSuppression": {"activeCount": int(suppression["count"]), "lastSeenAt": suppression["last_seen_at"]},
            "dailySendUsage": daily_send_usage,
        }

    def update_domain(self, actor, payload) -> dict:
        contract = build_mail_domain_contract(
            registered_domain=payload.registeredDomain,
            mail_domain=payload.mailDomain,
            inbound_mx_host=payload.inboundMxHost,
            admin_access_mode=payload.adminAccessMode,
            admin_allowed_cidrs=payload.adminAllowedCidrs,
        )
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT active_outbound_provider_key FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                state = cursor.fetchone()
                active_provider = state["active_outbound_provider_key"] if state else self._active_provider_key(cursor, actor.companyId)
                self.policy.save_domain_contract(cursor=cursor, company_id=actor.companyId, contract=contract, active_provider=active_provider)
                self._audit(cursor, actor, "mail_domain_settings", actor.companyId, "mail.domain.updated", contract.admin_access_mode)
            connection.commit()
        return self.get_overview(actor)

    def update_provider(self, actor, provider_key: str, payload) -> dict:
        if provider_key not in _PROVIDER_TYPES:
            raise ValueError("Provider는 self_hosted 또는 oci_email_delivery여야 합니다.")
        values = payload.model_dump(exclude_none=True)
        for secret_field in ("password", "dkimPrivateKey"):
            if secret_field in values:
                values[secret_field] = values[secret_field].get_secret_value()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                row = self._find_provider(cursor, actor.companyId, provider_key)
                if row is None:
                    row = self._create_locked_provider(cursor, actor.companyId, provider_key, values)
                merged_dkim_identity = (
                    values.get("dkimDomain", row.get("dkim_domain")),
                    values.get("dkimSelector", row.get("dkim_selector")),
                )
                if any(merged_dkim_identity) and not all(merged_dkim_identity):
                    raise ValueError("DKIM 도메인과 selector는 함께 설정해야 합니다.")
                if provider_key == "self_hosted":
                    merged_dkim = (
                        *merged_dkim_identity,
                        values.get("dkimPrivateKey") or row.get("encrypted_dkim_private_key"),
                    )
                    if any(merged_dkim) and not all(merged_dkim):
                        raise ValueError("자체 메일 엔진의 DKIM 도메인, selector, 개인키는 함께 설정해야 합니다.")
                updates: dict[str, object] = {}
                connection_changed = row.get("provider_type") != provider_key
                if connection_changed:
                    updates["provider_type"] = provider_key
                mapping = {
                    "relayHost": "relay_host", "relayPort": "relay_port", "tlsMode": "tls_mode",
                    "senderAddress": "from_address", "username": "username", "dkimDomain": "dkim_domain",
                    "dkimSelector": "dkim_selector",
                }
                for api_name, column in mapping.items():
                    if api_name in values:
                        updates[column] = values[api_name]
                        connection_changed = connection_changed or values[api_name] != row.get(column)
                if values.get("password"):
                    updates["encrypted_password"] = self.security.encrypt_secret(values["password"])
                    connection_changed = True
                if values.get("dkimPrivateKey"):
                    updates["encrypted_dkim_private_key"] = self.security.encrypt_secret(values["dkimPrivateKey"])
                    connection_changed = True
                if connection_changed:
                    if values.get("deliveryEnabled") is True:
                        raise ValueError("연결 설정 변경과 발송 활성화는 같은 요청에서 수행할 수 없습니다.")
                    updates.update({"delivery_enabled": False, "last_test_status": "untested", "last_test_message": "설정 변경 후 재검증이 필요합니다."})
                elif "deliveryEnabled" in values:
                    if values["deliveryEnabled"] and row.get("last_test_status") != "success":
                        raise ValueError("실제 연결 테스트 성공 후 발송을 활성화할 수 있습니다.")
                    updates["delivery_enabled"] = values["deliveryEnabled"]
                if updates:
                    columns = list(updates)
                    params = [updates[column] for column in columns]
                    assignments = ",".join(f"{column}=%s" for column in columns)
                    params.extend([datetime.now(UTC), row["id"], actor.companyId])
                    cursor.execute(f"UPDATE mail_provider_configs SET {assignments},updated_at=%s WHERE id=%s AND company_id=%s RETURNING *", tuple(params))
                    row = cursor.fetchone()
                    self._audit(cursor, actor, "mail_provider_config", row["id"], "mail.provider.updated", provider_key)
            connection.commit()
        return self._provider_view(dict(row))
    def generate_self_hosted_dkim(self, actor, selector: str | None = None) -> dict:
        normalized_selector = (selector or datetime.now(UTC).strftime("mw%Y%m")).strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", normalized_selector):
            raise ValueError("DKIM selector 형식이 올바르지 않습니다.")
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT mail_domain FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                domain = cursor.fetchone()
                if domain is None:
                    raise ValueError("먼저 메일 도메인 설정을 저장해야 합니다.")
                provider = self._find_provider(cursor, actor.companyId, "self_hosted")
                if provider is None:
                    raise ValueError("자체 메일 엔진 Provider 설정이 없습니다.")
                if provider.get("encrypted_dkim_private_key"):
                    raise ValueError("DKIM 키가 이미 설정되어 있어 자동으로 덮어쓸 수 없습니다.")
                private_pem, dns_value = generate_dkim_keypair()
                encrypted_private_key = self.security.encrypt_secret(private_pem)
                now = datetime.now(UTC)
                cursor.execute(
                    """UPDATE mail_provider_configs
                    SET dkim_domain=%s,dkim_selector=%s,encrypted_dkim_private_key=%s,
                        delivery_enabled=FALSE,last_test_status='untested',
                        last_test_message=%s,updated_at=%s
                    WHERE id=%s AND company_id=%s RETURNING *""",
                    (
                        domain["mail_domain"], normalized_selector, encrypted_private_key,
                        "DKIM 키 생성 후 공인 DNS 등록과 연결 테스트가 필요합니다.",
                        now, provider["id"], actor.companyId,
                    ),
                )
                updated = cursor.fetchone()
                self._audit(cursor, actor, "mail_provider_config", provider["id"], "mail.dkim.generated", normalized_selector)
            connection.commit()
        return {
            "provider": self._provider_view(dict(updated)),
            "dnsHost": f"{normalized_selector}._domainkey.{domain['mail_domain']}",
            "dnsValue": dns_value,
        }


    def switch_provider(self, actor, target_provider: str) -> dict:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT active_outbound_provider_key FROM mail_domain_settings WHERE company_id=%s FOR UPDATE", (actor.companyId,))
                state = cursor.fetchone()
                if state is None:
                    raise ValueError("먼저 메일 도메인 설정을 저장해야 합니다.")
                plan = self.policy.switch_outbound_provider(
                    cursor=cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                    actor_user_name=actor.userName, current_provider=state["active_outbound_provider_key"],
                    target_provider=target_provider,
                )
            connection.commit()
        return {"previousProvider": plan.previous_provider, "activeProvider": plan.new_message_provider, "pinnedQueueCount": len(plan.pinned_queue_providers)}

    def test_provider(self, actor, provider_key: str, recipient: str) -> dict:
        if provider_key not in _PROVIDER_TYPES:
            raise ValueError("Provider는 self_hosted 또는 oci_email_delivery여야 합니다.")
        now = datetime.now(UTC)
        error = None
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = self._find_provider(cursor, actor.companyId, provider_key)
                if provider is None:
                    raise ValueError("테스트할 Provider 설정이 없습니다.")
                cursor.execute("SELECT mail_domain,mail_host FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                domain = cursor.fetchone()
                if domain is None:
                    raise ValueError("먼저 메일 도메인 설정을 저장해야 합니다.")
                provider["provider_type"] = provider_key
                provider["password"] = self.security.decrypt_secret(provider["encrypted_password"]) if provider.get("username") else ""
                provider["dkim_private_key"] = self.security.decrypt_secret(provider["encrypted_dkim_private_key"]) if provider.get("encrypted_dkim_private_key") else ""
                provider["helo_name"] = domain["mail_host"]
                sender = str(provider.get("from_address") or f"postmaster@{domain['mail_domain']}")
                try:
                    envelope = {
                            "queue_id": f"connection-test-{uuid4().hex}", "sender_email": sender,
                            "recipient_email": recipient, "subject": "MoaWorks Provider 연결 테스트",
                            "body_text": "관리자 화면에서 실행한 실제 외부 SMTP 연결 테스트입니다.",
                    }
                    prepared = self.delivery_adapter.prepare(envelope, provider)
                    if getattr(self.delivery_adapter, "supports_attempt_reservation", False):
                        response = self.delivery_adapter.send_prepared(
                            prepared,
                            provider,
                            before_network_attempt=self.quota.reserve_attempt,
                        )
                    else:
                        self.quota.reserve_attempt()
                        response = self.delivery_adapter.send_prepared(prepared, provider)
                    test_status = "success"
                except MailDailySendLimitExceeded:
                    result = self._provider_view(provider)
                    result["quotaErrorCode"] = "MAIL_DAILY_SEND_LIMIT_EXCEEDED"
                    return result
                except MailDailyQuotaUnavailable:
                    result = self._provider_view(provider)
                    result["quotaErrorCode"] = "MAIL_DAILY_QUOTA_UNAVAILABLE"
                    return result
                except Exception as exc:
                    test_status, response, error = "failed", "", mask_delivery_error(str(exc))
                cursor.execute(
                    """UPDATE mail_provider_configs SET provider_type=%s,last_test_status=%s,delivery_enabled=%s,last_test_message=%s,last_connection_at=%s,
                    last_connection_error=%s,updated_at=%s WHERE id=%s AND company_id=%s RETURNING *""",
                    (provider_key, test_status, test_status == "success", response or "실제 외부 SMTP 연결 테스트 실패", now, error, now, provider["id"], actor.companyId),
                )
                updated = cursor.fetchone()
                self._audit(cursor, actor, "mail_provider_config", provider["id"], "mail.provider.tested", test_status)
            connection.commit()
        return self._provider_view(dict(updated))

    def rollback_provider(self, actor) -> dict:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                plan = self.policy.rollback_outbound_provider(
                    cursor=cursor, company_id=actor.companyId, actor_user_id=actor.userId, actor_user_name=actor.userName,
                )
            connection.commit()
        return {"previousProvider": plan.previous_provider, "activeProvider": plan.new_message_provider, "pinnedQueueCount": len(plan.pinned_queue_providers)}

    def sync_oci_suppressions(self, actor) -> dict:
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT mail_domain FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                state = cursor.fetchone()
                if state is None:
                    raise ValueError("먼저 메일 도메인 설정을 저장해야 합니다.")
                result = self.oci_operations.sync(
                    cursor=cursor, company_id=actor.companyId, actor_user_id=actor.userId,
                    actor_user_name=actor.userName, mail_domain=state["mail_domain"],
                )
            connection.commit()
        return result

    def _active_provider_key(self, cursor, company_id: str) -> str:
        cursor.execute("SELECT provider_type FROM mail_provider_configs WHERE company_id=%s ORDER BY active DESC,updated_at DESC LIMIT 1", (company_id,))
        row = cursor.fetchone()
        return self._provider_key(row["provider_type"]) if row else "self_hosted"

    @staticmethod
    def _find_provider(cursor, company_id: str, provider_key: str):
        cursor.execute("SELECT * FROM mail_provider_configs WHERE company_id=%s AND provider_type=ANY(%s) ORDER BY updated_at DESC LIMIT 1", (company_id, list(_PROVIDER_TYPES[provider_key])))
        row = cursor.fetchone()
        return dict(row) if row else None

    def _create_locked_provider(self, cursor, company_id: str, provider_key: str, values: dict) -> dict:
        provider_id = f"mail_provider_{uuid4().hex}"
        default_host = "" if provider_key == "oci_email_delivery" else "localhost"
        cursor.execute(
            """INSERT INTO mail_provider_configs(
                id,company_id,provider_type,relay_host,relay_port,username,encrypted_password,active,
                last_test_status,last_test_message,delivery_enabled,tls_mode,from_address,updated_at
            ) VALUES(%s,%s,%s,%s,%s,%s,%s,FALSE,'untested','연결 테스트가 필요합니다.',FALSE,%s,%s,%s) RETURNING *""",
            (
                provider_id, company_id, provider_key, values.get("relayHost", default_host),
                values.get("relayPort", 587 if provider_key == "oci_email_delivery" else 25),
                values.get("username", ""), self.security.encrypt_secret(values.get("password", "")),
                values.get("tlsMode", "starttls" if provider_key == "oci_email_delivery" else "none"),
                values.get("senderAddress"), datetime.now(UTC),
            ),
        )
        return dict(cursor.fetchone())

    @staticmethod
    def _audit(cursor, actor, target_type: str, target_id: str, event: str, after: str) -> None:
        cursor.execute(
            """INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                status_before,status_after,reason,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,%s)""",
            (f"audit_{uuid4().hex}", actor.companyId, actor.userId, actor.userName, target_type, target_id, event, after, "관리자 메일 운영 화면 변경", datetime.now(UTC)),
        )
