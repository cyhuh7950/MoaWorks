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
            items.extend(list(response.data or []))
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


class OciEmailOperations:
    def __init__(self, gateway: OciEmailGateway | None = None) -> None:
        self.gateway = gateway or OciEmailGateway()

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
