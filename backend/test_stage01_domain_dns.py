import unittest
from types import SimpleNamespace

from app.services.domain_service import DomainService


class FakeStore:
    def get_overview(self):
        return SimpleNamespace(company=SimpleNamespace(domain="moaworks.sinsan.kr"))


class FakeDnsResolver:
    def __init__(self, records):
        self.records = records
        self.calls = []

    def resolve(self, host: str, record_type: str) -> list[str]:
        self.calls.append((host, record_type))
        return self.records.get((host, record_type), [])

    def reverse(self, address: str) -> list[str]:
        self.calls.append((address, "PTR"))
        return self.records.get((address, "PTR"), [])


class DomainDnsVerificationTest(unittest.TestCase):
    def test_verification_uses_actual_a_mx_txt_and_ptr_results(self) -> None:
        resolver = FakeDnsResolver({
            ("mail.moaworks.sinsan.kr", "A"): ["168.107.4.6"],
            ("moaworks.sinsan.kr", "MX"): ["10 mail.moaworks.sinsan.kr"],
            ("moaworks.sinsan.kr", "TXT"): ["v=spf1 ip4:168.107.4.6 ~all"],
            ("selector1._domainkey.moaworks.sinsan.kr", "TXT"): ["v=DKIM1; k=rsa; p=PUBLIC"],
            ("_dmarc.moaworks.sinsan.kr", "TXT"): ["v=DMARC1; p=none"],
            ("168.107.4.6", "PTR"): ["mail.moaworks.sinsan.kr"],
        })

        result = DomainService(FakeStore(), resolver=resolver).verify("moaworks.sinsan.kr")

        statuses = {item.recordType: item.status for item in result.checks}
        self.assertEqual(result.overallStatus, "pass")
        self.assertEqual(statuses, {"A": "pass", "MX": "pass", "SPF": "pass", "DKIM": "pass", "DMARC": "pass", "PTR": "pass"})
        self.assertIn(("moaworks.sinsan.kr", "MX"), resolver.calls)
        self.assertIn(("168.107.4.6", "PTR"), resolver.calls)

    def test_missing_records_are_not_reported_as_pass(self) -> None:
        result = DomainService(FakeStore(), resolver=FakeDnsResolver({})).verify("moaworks.sinsan.kr")

        self.assertEqual(result.overallStatus, "warning")
        self.assertTrue(all(item.status != "pass" for item in result.checks))
        self.assertTrue(any("조회되지" in item.message for item in result.checks))


if __name__ == "__main__":
    unittest.main()
