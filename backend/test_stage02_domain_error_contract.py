from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services.domain_service import DnsLookupError, DomainService


class _Store:
    def get_overview(self):
        return SimpleNamespace(company=SimpleNamespace(domain="moaworks.sinsan.kr"))


class _Resolver:
    def __init__(self, records: dict[tuple[str, str], list[str]], failing: set[tuple[str, str]] | None = None) -> None:
        self.records = records
        self.failing = failing or set()

    def resolve(self, host: str, record_type: str) -> list[str]:
        if (host, record_type) in self.failing:
            raise DnsLookupError("공인 DNS resolver 응답을 확인할 수 없습니다.")
        return self.records.get((host, record_type), [])

    def reverse(self, address: str) -> list[str]:
        return self.records.get((address, "PTR"), [])


class Stage02DomainErrorContractTest(unittest.TestCase):
    def test_missing_mismatched_and_unavailable_dns_have_stable_codes(self) -> None:
        result = DomainService(
            _Store(),
            resolver=_Resolver(
                {
                    ("mail.moaworks.sinsan.kr", "A"): ["168.107.4.6"],
                    ("moaworks.sinsan.kr", "MX"): ["10 legacy.example.net"],
                },
                failing={("_dmarc.moaworks.sinsan.kr", "TXT")},
            ),
        ).verify("moaworks.sinsan.kr")

        codes = {item.recordType: item.code for item in result.checks}

        self.assertEqual(codes["A"], "DNS_RECORD_MATCHED")
        self.assertEqual(codes["MX"], "DNS_RECORD_MISMATCH")
        self.assertEqual(codes["SPF"], "DNS_RECORD_MISSING")
        self.assertEqual(codes["DMARC"], "DNS_LOOKUP_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
