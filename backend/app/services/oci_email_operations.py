from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable
from uuid import uuid4

from app.core.config import settings


@dataclass(frozen=True, slots=True)
class OciEmailSnapshot:
    suppressions: tuple[dict, ...]
    approved_senders: tuple[dict, ...]
    email_domains: tuple[dict, ...]


def _value(item, name: str, default=None):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def build_desired_sender_emails(user_rows: list[dict], mail_domain: str, protected_emails: set[str]) -> set[str]:
    suffix = f"@{mail_domain.strip().lower()}"
    desired = {
        email.strip().lower()
        for email in protected_emails
        if email and email.strip() and email.strip().lower().endswith(suffix)
    }
    desired.update(
        email.strip().lower()
        for row in user_rows
        if str(row.get("status", "")).strip().lower() == "active"
        for email in [str(row.get("email", ""))]
        if email.strip().lower().endswith(suffix)
    )
    return desired


class OciEmailGateway:
    def __init__(self, client_factory: Callable | None = None) -> None:
        self.client_factory = client_factory

    def _client(self):
        if self.client_factory is not None:
            return self.client_factory()
        if not settings.oci_email_api_enabled:
            raise ValueError("OCI Email API 동기화가 비활성화되어 있습니다.")
        if not settings.oci_region or not settings.oci_tenancy_id or not settings.oci_compartment_id:
            raise ValueError("OCI region, tenancy OCID, compartment OCID가 필요합니다.")
        try:
            import oci
        except ImportError as exc:
            raise RuntimeError("OCI Python SDK가 설치되지 않았습니다.") from exc
        signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
        return oci.email.EmailClient({"region": settings.oci_region}, signer=signer)

    @staticmethod
    def _all_pages(call, *args, **kwargs) -> list:
        items: list = []
        page = None
        while True:
            response = call(*args, page=page, limit=1000, **kwargs) if page else call(*args, limit=1000, **kwargs)
            response_data = response.data
            collection_items = getattr(response_data, "items", None)
            items.extend(list(collection_items if collection_items is not None else response_data or []))
            page = (response.headers or {}).get("opc-next-page")
            if not page:
                return items

    def snapshot(self, mail_domain: str) -> OciEmailSnapshot:
        client = self._client()
        suppressions = self._all_pages(client.list_suppressions, settings.oci_tenancy_id)
        senders = self._all_pages(client.list_senders, settings.oci_compartment_id, domain=mail_domain)
        domains = self._all_pages(client.list_email_domains, settings.oci_compartment_id, name=mail_domain)
        return OciEmailSnapshot(
            suppressions=tuple(
                {
                    "email": str(_value(item, "email_address", "")).strip().lower(),
                    "reason": str(_value(item, "reason", "UNKNOWN")),
                    "timeCreated": _value(item, "time_created"),
                }
                for item in suppressions
                if str(_value(item, "email_address", "")).strip()
            ),
            approved_senders=tuple(
                {
                    "id": str(_value(item, "id", "")),
                    "email": str(_value(item, "email_address", "")),
                    "status": str(_value(item, "lifecycle_state", "UNKNOWN")),
                }
                for item in senders
            ),
            email_domains=tuple(
                {
                    "name": str(_value(item, "name", "")),
                    "status": str(_value(item, "lifecycle_state", "UNKNOWN")),
                }
                for item in domains
            ),
        )

    def create_sender(self, email: str) -> dict:
        normalized = email.strip().lower()
        if not normalized:
            raise ValueError("OCI 승인 발신자 이메일이 필요합니다.")
        try:
            import oci
        except ImportError as exc:
            if self.client_factory is None:
                raise RuntimeError("OCI Python SDK가 설치되지 않았습니다.") from exc
            from types import SimpleNamespace
            details = SimpleNamespace(compartment_id=settings.oci_compartment_id, email_address=normalized)
        else:
            details = oci.email.models.CreateSenderDetails(
                compartment_id=settings.oci_compartment_id,
                email_address=normalized,
            )
        response = self._client().create_sender(details)
        item = response.data
        return {
            "id": str(_value(item, "id", "")),
            "email": str(_value(item, "email_address", normalized)),
            "status": str(_value(item, "lifecycle_state", "CREATING")),
        }

    def delete_sender(self, sender_id: str) -> None:
        if not sender_id.strip():
            raise ValueError("OCI 승인 발신자 ID가 필요합니다.")
        self._client().delete_sender(sender_id.strip())

    def reconcile_senders(
        self,
        mail_domain: str,
        desired_emails: set[str],
        protected_emails: set[str],
    ) -> dict:
        desired = {email.strip().lower() for email in desired_emails if email and email.strip()}
        protected = {email.strip().lower() for email in protected_emails if email and email.strip()}
        snapshot = self.snapshot(mail_domain)
        existing = {
            item["email"].strip().lower(): item
            for item in snapshot.approved_senders
            if item.get("email", "").strip()
        }
        created = 0
        deleted = 0
        for email in sorted(desired - set(existing)):
            self.create_sender(email)
            created += 1
        for email, item in sorted(existing.items()):
            if email not in protected and email not in desired and item.get("id"):
                self.delete_sender(item["id"])
                deleted += 1
        return {"created": created, "deleted": deleted, "unchanged": len(desired & set(existing))}


class OciEmailOperations:
    def __init__(self, gateway: OciEmailGateway | None = None) -> None:
        self.gateway = gateway or OciEmailGateway()

    def reconcile_company(self, *, db, company_id: str, mail_domain: str) -> dict:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT email,status FROM users WHERE company_id=%s",
                (company_id,),
            )
            users = cursor.fetchall()
            cursor.execute(
                "SELECT from_address FROM mail_provider_configs WHERE company_id=%s AND provider_type IN ('oci_email_delivery','oci_smtp') AND active=TRUE",
                (company_id,),
            )
            protected = {str(row.get("from_address", "")) for row in cursor.fetchall() if row.get("from_address")}
        desired = build_desired_sender_emails(users, mail_domain, protected)
        return self.gateway.reconcile_senders(mail_domain, desired, protected)

    def sync(self, *, cursor, company_id: str, actor_user_id: str, actor_user_name: str, mail_domain: str) -> dict:
        snapshot = self.gateway.snapshot(mail_domain)
        now = datetime.now(UTC)
        cursor.execute("UPDATE mail_oci_suppressions SET active=FALSE,last_seen_at=%s WHERE company_id=%s", (now, company_id))
        for item in snapshot.suppressions:
            cursor.execute(
                """INSERT INTO mail_oci_suppressions(
                    id,company_id,recipient_email,reason,source,active,first_seen_at,last_seen_at
                ) VALUES(%s,%s,%s,%s,'oci',TRUE,%s,%s)
                ON CONFLICT(company_id,recipient_email) DO UPDATE
                SET reason=EXCLUDED.reason,source='oci',active=TRUE,last_seen_at=EXCLUDED.last_seen_at""",
                (f"suppression_{uuid4().hex}", company_id, item["email"], item["reason"], now, now),
            )
        cursor.execute(
            """INSERT INTO audit_logs(
                id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                status_before,status_after,reason,created_at
            ) VALUES(%s,%s,%s,%s,'mail_oci_suppression',%s,'mail.oci_suppression.synced',NULL,%s,%s,%s)""",
            (
                f"audit_{uuid4().hex}", company_id, actor_user_id, actor_user_name, company_id,
                str(len(snapshot.suppressions)), "OCI suppression 목록을 API로 동기화했습니다.", now,
            ),
        )
        return {
            "suppressionCount": len(snapshot.suppressions),
            "approvedSenders": list(snapshot.approved_senders),
            "emailDomains": list(snapshot.email_domains),
            "syncedAt": now,
        }
