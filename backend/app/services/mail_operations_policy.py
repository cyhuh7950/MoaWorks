from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_network
import re
from typing import Mapping, Sequence


_ADMIN_ACCESS_MODES = frozenset({"public", "restricted", "private"})
_OUTBOUND_PROVIDERS = frozenset({"self_hosted", "oci_email_delivery"})
_DOMAIN_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


@dataclass(frozen=True, slots=True)
class MailDomainContract:
    registered_domain: str
    mail_domain: str
    user_host: str
    admin_host: str
    mail_host: str
    admin_access_mode: str
    admin_allowed_cidrs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ProviderSwitchPlan:
    previous_provider: str
    new_message_provider: str
    pinned_queue_providers: dict[str, str]
    automatic_cross_provider_retry: bool = False


@dataclass(frozen=True, slots=True)
class SmtpDeliveryClassification:
    functional_success: bool
    mailbox_placement: str | None


def build_mail_domain_contract(
    *,
    registered_domain: str,
    mail_domain: str,
    admin_access_mode: str,
    admin_allowed_cidrs: Sequence[str] | None = None,
) -> MailDomainContract:
    normalized_registered = _normalize_domain(registered_domain)
    normalized_mail = _normalize_domain(mail_domain)
    if normalized_mail != normalized_registered and not normalized_mail.endswith(
        f".{normalized_registered}"
    ):
        raise ValueError("메일 도메인은 등록 도메인과 같거나 그 하위 도메인이어야 합니다.")

    normalized_mode = admin_access_mode.strip().lower()
    if normalized_mode not in _ADMIN_ACCESS_MODES:
        raise ValueError("관리자 접근 모드는 public, restricted, private 중 하나여야 합니다.")
    cidr_values = (
        ("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        if admin_allowed_cidrs is None
        else admin_allowed_cidrs
    )
    try:
        normalized_cidrs = tuple(dict.fromkeys(str(ip_network(value.strip(), strict=False)) for value in cidr_values))
    except (AttributeError, ValueError) as exc:
        raise ValueError("관리자 허용 IP/CIDR 형식이 올바르지 않습니다.") from exc
    if normalized_mode == "restricted" and not normalized_cidrs:
        raise ValueError("restricted 관리자 접근 모드에는 허용 IP/CIDR이 한 개 이상 필요합니다.")

    return MailDomainContract(
        registered_domain=normalized_registered,
        mail_domain=normalized_mail,
        user_host=f"user.{normalized_mail}",
        admin_host=f"admin.{normalized_mail}",
        mail_host=f"mail.{normalized_mail}",
        admin_access_mode=normalized_mode,
        admin_allowed_cidrs=normalized_cidrs,
    )


def plan_provider_switch(
    *,
    current_provider: str,
    target_provider: str,
    queued_items: Sequence[Mapping[str, object]],
) -> ProviderSwitchPlan:
    normalized_current = _normalize_provider(current_provider)
    normalized_target = _normalize_provider(target_provider)
    pinned: dict[str, str] = {}
    for item in queued_items:
        queue_id = str(item.get("queue_id") or "").strip()
        if not queue_id:
            raise ValueError("발송 큐 ID가 필요합니다.")
        if queue_id in pinned:
            raise ValueError("동일한 발송 큐 ID가 중복되었습니다.")
        pinned[queue_id] = _normalize_provider(str(item.get("provider_key") or ""))

    return ProviderSwitchPlan(
        previous_provider=normalized_current,
        new_message_provider=normalized_target,
        pinned_queue_providers=pinned,
    )


def classify_smtp_delivery(
    *,
    remote_smtp_accepted: bool,
    mailbox_placement: str | None,
) -> SmtpDeliveryClassification:
    normalized_placement = mailbox_placement.strip().lower() if mailbox_placement else None
    return SmtpDeliveryClassification(
        functional_success=bool(remote_smtp_accepted),
        mailbox_placement=normalized_placement,
    )


def _normalize_provider(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in _OUTBOUND_PROVIDERS:
        raise ValueError("발신 Provider는 self_hosted 또는 oci_email_delivery여야 합니다.")
    return normalized


def _normalize_domain(value: str) -> str:
    raw = value.strip().lower().rstrip(".")
    if not raw or "://" in raw or "@" in raw or ":" in raw or ".." in raw:
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    try:
        normalized = raw.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("도메인 형식이 올바르지 않습니다.") from exc
    if len(normalized) > 253:
        raise ValueError("도메인 길이가 허용 범위를 초과했습니다.")
    labels = normalized.split(".")
    if len(labels) < 2 or any(not _DOMAIN_LABEL.fullmatch(label) for label in labels):
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    return normalized
