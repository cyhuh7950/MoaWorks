"""Additional mail identities; login identities and the one-mailbox model stay unchanged."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import dns.resolver
from pydantic import EmailStr, TypeAdapter, ValidationError

from app.services.mail_operations_policy import _normalize_domain
from app.services.oci_email_operations import OciEmailGateway
from app.services.postgres_service import PostgresService


class MailIdentityService:
    _email_adapter = TypeAdapter(EmailStr)

    @classmethod
    def _normalize_address(cls, raw_address: str) -> str:
        try:
            return str(cls._email_adapter.validate_python(raw_address.strip())).lower()
        except (ValidationError, AttributeError) as exc:
            raise ValueError("올바른 메일 주소를 입력해 주세요.") from exc

    def __init__(self, db=None, oci_gateway=None, mx_resolver=None):
        self.db = db or PostgresService()
        self.oci_gateway = oci_gateway or OciEmailGateway()
        self.mx_resolver = mx_resolver or dns.resolver.resolve

    @staticmethod
    def _audit(cursor, actor, target_type: str, target_id: str, event: str):
        cursor.execute(
            """INSERT INTO audit_logs
               (id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                status_before,status_after,reason,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,NULL,NULL,%s)""",
            (f"audit_{uuid4().hex}", actor.companyId, actor.userId, actor.userName,
             target_type, target_id, event, datetime.now(UTC)),
        )

    @staticmethod
    def _domain_view(row):
        return {"domain": row["domain"], "status": row["status"], "isPrimary": bool(row["is_primary"])}

    @staticmethod
    def _address_view(row):
        return {
            "address": row["address"], "userId": row["user_id"],
            "isPrimary": bool(row["is_primary"]), "active": bool(row["active"]),
            "sendRequested": bool(row["send_requested"]),
            "sendEnabled": bool(row["send_enabled"]),
            "domainStatus": row.get("domain_status", "pending"),
        }

    def list_domains(self, actor):
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT domain,status,is_primary FROM mail_managed_domains WHERE company_id=%s ORDER BY is_primary DESC,domain",
                (actor.companyId,),
            )
            return [self._domain_view(row) for row in cursor.fetchall()]

    def add_domain(self, actor, raw_domain: str):
        domain = _normalize_domain(raw_domain)
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT registered_domain FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                settings = cursor.fetchone()
                if not settings:
                    raise ValueError("메일 도메인 설정을 먼저 완료해야 합니다.")
                registered = settings["registered_domain"].lower()
                if domain != registered and not domain.endswith(f".{registered}"):
                    raise ValueError("등록 도메인 또는 하위 도메인만 추가할 수 있습니다.")
                cursor.execute(
                    """INSERT INTO mail_managed_domains (company_id,domain,status,is_primary)
                       VALUES (%s,%s,'pending',FALSE) ON CONFLICT DO NOTHING RETURNING domain,status,is_primary""",
                    (actor.companyId, domain),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError("이미 등록된 메일 도메인입니다.")
                self._audit(cursor, actor, "mail_domain", domain, "mail.domain.added")
            connection.commit()
        return self._domain_view(row)

    def set_domain_status(self, actor, raw_domain: str, status: str):
        domain = _normalize_domain(raw_domain)
        if status not in {"pending", "active"}:
            raise ValueError("메일 도메인 상태가 올바르지 않습니다.")
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT domain,status,is_primary FROM mail_managed_domains WHERE company_id=%s AND domain=%s FOR UPDATE",
                    (actor.companyId, domain),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError("등록된 메일 도메인을 찾을 수 없습니다.")
                if row["is_primary"] and status != "active":
                    raise ValueError("기존 기본 메일 도메인은 비활성화할 수 없습니다.")
                if status == "active" and row["status"] != "active":
                    cursor.execute("SELECT inbound_mx_host,mail_host FROM mail_domain_settings WHERE company_id=%s", (actor.companyId,))
                    config = cursor.fetchone()
                    expected = (config.get("inbound_mx_host") or config["mail_host"]).lower().rstrip(".")
                    try:
                        answers = self.mx_resolver(domain, "MX", lifetime=10)
                        hosts = {str(answer.exchange).lower().rstrip(".") for answer in answers}
                    except Exception as exc:
                        raise ValueError("추가 도메인의 수신 MX를 확인할 수 없습니다.") from exc
                    if expected not in hosts:
                        raise ValueError(f"추가 도메인의 MX가 {expected}를 가리켜야 합니다.")
                cursor.execute(
                    """UPDATE mail_managed_domains SET status=%s,updated_at=NOW()
                       WHERE company_id=%s AND domain=%s RETURNING domain,status,is_primary""",
                    (status, actor.companyId, domain),
                )
                row = cursor.fetchone()
                self._audit(cursor, actor, "mail_domain", domain, f"mail.domain.{status}")
            connection.commit()
        return self._domain_view(row)

    def list_addresses(self, actor, user_id: str | None = None):
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT a.address,a.user_id,a.is_primary,a.active,a.send_requested,a.send_enabled,
                          COALESCE(d.status,'pending') AS domain_status
                   FROM mail_addresses a JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id
                   LEFT JOIN mail_managed_domains d ON d.company_id=a.company_id
                       AND d.domain=split_part(a.address,'@',2)
                   WHERE a.company_id=%s AND (%s IS NULL OR a.user_id=%s)
                   ORDER BY a.user_id,a.is_primary DESC,a.address""",
                (actor.companyId, user_id, user_id),
            )
            return [self._address_view(row) for row in cursor.fetchall()]

    def list_my_addresses(self, actor):
        return [row for row in self.list_addresses(actor, actor.userId)
                if row["active"] and row["sendEnabled"] and row["domainStatus"] == "active"]

    def add_address(self, actor, user_id: str, raw_address: str):
        address = self._normalize_address(raw_address)
        domain = address.rsplit("@", 1)[-1]
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT id,status FROM users WHERE id=%s AND company_id=%s FOR UPDATE", (user_id, actor.companyId))
                user = cursor.fetchone()
                if not user or user["status"] != "active":
                    raise ValueError("활성 사용자에게만 메일 주소를 연결할 수 있습니다.")
                cursor.execute("SELECT status FROM mail_managed_domains WHERE company_id=%s AND domain=%s", (actor.companyId, domain))
                domain_row = cursor.fetchone()
                if not domain_row:
                    raise ValueError("회사에 등록된 메일 도메인만 사용할 수 있습니다.")
                cursor.execute(
                    """INSERT INTO mail_addresses
                       (id,company_id,user_id,address,is_primary,active,send_requested,send_enabled)
                       VALUES (%s,%s,%s,%s,FALSE,FALSE,FALSE,FALSE)
                       ON CONFLICT DO NOTHING RETURNING address,user_id,is_primary,active,send_requested,send_enabled""",
                    (f"mailaddr_{uuid4().hex}", actor.companyId, user_id, address),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError("이미 사용 중인 메일 주소입니다.")
                self._audit(cursor, actor, "mail_address", address, "mail.address.added")
            connection.commit()
        return {**self._address_view(row), "domainStatus": domain_row["status"]}

    def set_address_status(self, actor, user_id: str, raw_address: str, *, active: bool, send_requested: bool, send_enabled: bool):
        address = self._normalize_address(raw_address)
        if (send_enabled or send_requested) and not active:
            raise ValueError("비활성 주소는 발신할 수 없습니다.")
        if send_enabled and not send_requested:
            raise ValueError("발신 준비 요청을 먼저 완료해야 합니다.")
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """SELECT a.address,a.user_id,a.is_primary,a.active,a.send_requested,a.send_enabled,
                              COALESCE(d.status,'pending') AS domain_status
                       FROM mail_addresses a
                       LEFT JOIN mail_managed_domains d ON d.company_id=a.company_id AND d.domain=split_part(a.address,'@',2)
                       WHERE a.company_id=%s AND a.user_id=%s AND a.address=%s FOR UPDATE OF a""",
                    (actor.companyId, user_id, address),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError("연결된 메일 주소를 찾을 수 없습니다.")
                if row["is_primary"]:
                    raise ValueError("기본 주소는 기존 사용자 관리에서만 변경할 수 있습니다.")
                if active and row["domain_status"] != "active":
                    raise ValueError("메일 도메인의 MX 확인과 활성화를 먼저 완료해야 합니다.")
                if send_enabled:
                    self._assert_outbound_ready(cursor, actor.companyId, address)
                domain_status = row["domain_status"]
                cursor.execute(
                    """UPDATE mail_addresses SET active=%s,send_requested=%s,send_enabled=%s,updated_at=NOW()
                       WHERE company_id=%s AND user_id=%s AND address=%s
                       RETURNING address,user_id,is_primary,active,send_requested,send_enabled""",
                    (active, send_requested, send_enabled, actor.companyId, user_id, address),
                )
                row = cursor.fetchone()
                self._audit(cursor, actor, "mail_address", address, "mail.address.status_changed")
            connection.commit()
        return {**self._address_view(row), "domainStatus": domain_status}

    def _assert_outbound_ready(self, cursor, company_id: str, address: str):
        provider = self._assert_outbound_policy_local(cursor, company_id, address)
        if provider["provider_type"] not in {"oci_email_delivery", "oci_smtp"}:
            return
        domain = address.rsplit("@", 1)[-1]
        try:
            snapshot = self.oci_gateway.snapshot(domain)
        except Exception as exc:
            raise ValueError("OCI 도메인과 승인 발신자를 확인할 수 없습니다.") from exc
        if not any(item["name"].lower() == domain and item["status"].upper() == "ACTIVE"
                   for item in snapshot.email_domains):
            raise ValueError("OCI 발신 도메인이 ACTIVE 상태가 아닙니다.")
        if not any(item["email"].lower() == address and item["status"].upper() == "ACTIVE"
                   for item in snapshot.approved_senders):
            raise ValueError("OCI 승인 발신자에 이 주소가 없습니다.")

    def _assert_outbound_policy_local(self, cursor, company_id: str, address: str):
        """Cheap queue-time policy: remote OCI state was checked when send was enabled."""
        domain = address.rsplit("@", 1)[-1]
        cursor.execute(
            """SELECT p.provider_type,p.dkim_domain,p.encrypted_dkim_private_key
               FROM mail_provider_configs p WHERE p.company_id=%s AND p.active=TRUE""",
            (company_id,),
        )
        provider = cursor.fetchone()
        if not provider:
            raise ValueError("활성 발신 공급자가 없습니다.")
        if provider["provider_type"] in {"self_hosted", "self_hosted_smtp", "smtp"}:
            if (provider.get("dkim_domain") or "").lower() != domain or not provider.get("encrypted_dkim_private_key"):
                raise ValueError("자체발신은 해당 도메인의 DKIM 서명 설정 전까지 사용할 수 없습니다.")
        elif provider["provider_type"] not in {"oci_email_delivery", "oci_smtp"}:
            raise ValueError("지원하지 않는 발신 공급자입니다.")
        return provider

    @staticmethod
    def resolve_sender(cursor, company_id: str, user_id: str, address: str):
        normalized = MailIdentityService._normalize_address(address)
        cursor.execute(
            """SELECT a.address,a.is_primary FROM mail_addresses a
               JOIN mail_managed_domains d ON d.company_id=a.company_id AND d.domain=split_part(a.address,'@',2)
               JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id
               WHERE a.company_id=%s AND a.user_id=%s AND a.address=%s AND a.active=TRUE
                 AND a.send_enabled=TRUE AND d.status='active' AND u.status='active'""",
            (company_id, user_id, normalized),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("이 사용자에게 허용되지 않았거나 준비되지 않은 발신 주소입니다.")
        return normalized, not row["is_primary"]
