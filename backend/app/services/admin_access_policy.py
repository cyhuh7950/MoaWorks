from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address, ip_network
from typing import Sequence

from app.core.config import settings
from app.services.postgres_service import PostgresService


_PRIVATE_NETWORKS = tuple(
    ip_network(value)
    for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "fc00::/7", "::1/128")
)


@dataclass(frozen=True, slots=True)
class AdminAccessDecision:
    allowed: bool
    mode: str
    reason: str


def evaluate_admin_access(mode: str, allowed_cidrs: Sequence[str], client_ip: str) -> AdminAccessDecision:
    normalized_mode = mode.strip().lower()
    try:
        address = ip_address(client_ip.strip())
    except ValueError:
        return AdminAccessDecision(False, normalized_mode, "invalid_client_ip")
    if normalized_mode == "public":
        return AdminAccessDecision(True, normalized_mode, "public_mode")
    if normalized_mode == "private":
        allowed = any(address.version == network.version and address in network for network in _PRIVATE_NETWORKS)
        return AdminAccessDecision(allowed, normalized_mode, "private_network" if allowed else "public_client_blocked")
    if normalized_mode != "restricted":
        return AdminAccessDecision(False, normalized_mode, "invalid_access_mode")
    try:
        networks = [ip_network(value.strip(), strict=False) for value in allowed_cidrs]
    except ValueError:
        return AdminAccessDecision(False, normalized_mode, "invalid_allowed_cidr")
    allowed = any(address in network for network in networks)
    return AdminAccessDecision(allowed, normalized_mode, "allowed_cidr" if allowed else "cidr_not_allowed")


class AdminAccessOperations:
    def __init__(self, db=None) -> None:
        self.db = db or PostgresService()

    def check(self, client_ip: str) -> AdminAccessDecision:
        mode = settings.admin_access_bootstrap_mode
        cidrs = settings.admin_access_bootstrap_cidrs
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.mail_domain_settings') AS relation")
                relation = cursor.fetchone()
                if relation and relation.get("relation"):
                    cursor.execute(
                        """SELECT admin_access_mode,admin_allowed_cidrs
                        FROM mail_domain_settings ORDER BY updated_at DESC LIMIT 1"""
                    )
                    row = cursor.fetchone()
                    if row:
                        mode = row["admin_access_mode"]
                        cidrs = list(row.get("admin_allowed_cidrs") or [])
        return evaluate_admin_access(mode, cidrs, client_ip)
