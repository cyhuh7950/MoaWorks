from __future__ import annotations

from typing import Protocol

import dns.exception
import dns.reversename
import dns.resolver

from app.schemas.directory import DomainVerifyItem, DomainVerifyResponse
from app.services.directory_store import DirectoryStore


class DnsLookupError(RuntimeError):
    pass


class DnsResolver(Protocol):
    def resolve(self, host: str, record_type: str) -> list[str]: ...

    def reverse(self, address: str) -> list[str]: ...


class DnsPythonResolver:
    def resolve(self, host: str, record_type: str) -> list[str]:
        try:
            answers = dns.resolver.resolve(host, record_type, lifetime=10)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return []
        except (dns.exception.Timeout, dns.resolver.NoNameservers) as exc:
            raise DnsLookupError("공인 DNS resolver 응답을 확인할 수 없습니다.") from exc
        if record_type == "MX":
            return [f"{int(answer.preference)} {str(answer.exchange).rstrip('.').lower()}" for answer in answers]
        if record_type == "TXT":
            return [b"".join(answer.strings).decode("utf-8", errors="replace") for answer in answers]
        return [str(answer).rstrip(".").lower() for answer in answers]

    def reverse(self, address: str) -> list[str]:
        try:
            answers = dns.resolver.resolve(dns.reversename.from_address(address), "PTR", lifetime=10)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return []
        except (dns.exception.Timeout, dns.resolver.NoNameservers) as exc:
            raise DnsLookupError("공인 PTR resolver 응답을 확인할 수 없습니다.") from exc
        return [str(answer).rstrip(".").lower() for answer in answers]


class DomainService:
    def __init__(self, store: DirectoryStore, resolver: DnsResolver | None = None) -> None:
        self.store = store
        self.resolver = resolver or DnsPythonResolver()

    def verify(
        self,
        domain: str,
        *,
        managed_domain: str | None = None,
        mail_host: str | None = None,
        inbound_mx_host: str | None = None,
        dkim_selector: str | None = None,
    ) -> DomainVerifyResponse:
        normalized = domain.strip().lower().rstrip(".")
        if "." not in normalized:
            raise ValueError("도메인 형식이 올바르지 않습니다.")

        company = self.store.get_overview().company
        expected_domain = (managed_domain or company.domain).strip().lower().rstrip(".")
        matches_company = normalized == expected_domain
        mail_host = (mail_host or f"mail.{normalized}").strip().lower().rstrip(".")
        inbound_mx_host = (inbound_mx_host or mail_host).strip().lower().rstrip(".")
        selector = (dkim_selector or "selector1").strip().lower().rstrip(".")
        dkim_host = f"{selector}._domainkey.{normalized}"
        dmarc_host = f"_dmarc.{normalized}"

        a_values, a_error = self._lookup(mail_host, "A")
        if inbound_mx_host == mail_host:
            inbound_a_values, inbound_a_error = a_values, a_error
        else:
            inbound_a_values, inbound_a_error = self._lookup(inbound_mx_host, "A")
        mx_values, mx_error = self._lookup(normalized, "MX")
        root_txt, root_txt_error = self._lookup(normalized, "TXT")
        dkim_values, dkim_error = self._lookup(dkim_host, "TXT")
        dmarc_values, dmarc_error = self._lookup(dmarc_host, "TXT")

        checks = [
            self._check("A", mail_host, "공인 IPv4 주소", a_values, bool(a_values), a_error),
            self._check(
                "MX", normalized, f"10 {inbound_mx_host}", mx_values,
                any(value.split(maxsplit=1)[-1].rstrip(".").lower() == inbound_mx_host for value in mx_values), mx_error,
            ),
            self._check(
                "SPF", normalized, "v=spf1 <self-hosted IP and/or OCI include> ~all", root_txt,
                any(value.lower().startswith("v=spf1") for value in root_txt), root_txt_error,
            ),
            self._check(
                "DKIM", dkim_host, "v=DKIM1; k=rsa; p=<public-key>", dkim_values,
                any(value.lower().startswith("v=dkim1") for value in dkim_values), dkim_error,
            ),
            self._check(
                "DMARC", dmarc_host, "v=DMARC1; p=none", dmarc_values,
                any(value.lower().startswith("v=dmarc1") for value in dmarc_values), dmarc_error,
            ),
        ]

        if inbound_mx_host != mail_host:
            checks.insert(
                1,
                self._check("MX-A", inbound_mx_host, "공인 IPv4 주소", inbound_a_values,
                            bool(inbound_a_values), inbound_a_error),
            )

        ptr_values: list[str] = []
        ptr_error: str | None = None
        for address in a_values:
            try:
                ptr_values.extend(self.resolver.reverse(address))
            except DnsLookupError as exc:
                ptr_error = str(exc)
                break
        checks.append(
            self._check(
                "PTR", ", ".join(a_values) or mail_host, mail_host, ptr_values,
                bool(a_values) and mail_host in ptr_values, ptr_error,
            )
        )

        all_pass = matches_company and all(check.status == "pass" for check in checks)
        return DomainVerifyResponse(
            domain=normalized,
            overallStatus="pass" if all_pass else "warning",
            checks=checks,
        )

    def _lookup(self, host: str, record_type: str) -> tuple[list[str], str | None]:
        try:
            return self.resolver.resolve(host, record_type), None
        except DnsLookupError as exc:
            return [], str(exc)

    @staticmethod
    def _check(record_type, host, expected, actual, matched, error) -> DomainVerifyItem:
        if error:
            status = "error"
            code = "DNS_LOOKUP_UNAVAILABLE"
            message = error
        elif not actual:
            status = "warning"
            code = "DNS_RECORD_MISSING"
            message = f"실제 공인 DNS에서 {record_type} 레코드가 조회되지 않았습니다."
        elif matched:
            status = "pass"
            code = "DNS_RECORD_MATCHED"
            message = "실제 공인 DNS 조회값이 운영 기준과 일치합니다."
        else:
            status = "warning"
            code = "DNS_RECORD_MISMATCH"
            message = "실제 공인 DNS 조회값이 운영 기준과 다릅니다: " + ", ".join(actual)
        return DomainVerifyItem(
            recordType=record_type,
            host=host,
            expectedValue=expected,
            status=status,
            code=code,
            message=message,
        )
