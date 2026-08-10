import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes.admin import verify_domain
from app.schemas.directory import DomainVerifyRequest

import dns.exception
import dns.resolver

from app.services.domain_service import DnsLookupError, DnsPythonResolver, DomainService


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


class TextAnswer:
    def __init__(self, value: str):
        self.value = value

    def __str__(self) -> str:
        return self.value


class DomainDnsVerificationTest(unittest.TestCase):
    def test_invalid_domain_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "도메인 형식"):
            DomainService(FakeStore(), resolver=FakeDnsResolver({})).verify("localhost")

    @patch("dns.resolver.resolve")
    def test_dns_python_resolver_formats_a_mx_txt_and_ptr(self, resolve) -> None:
        resolver = DnsPythonResolver()
        resolve.return_value = [TextAnswer("168.107.4.6.")]
        self.assertEqual(resolver.resolve("mail.example", "A"), ["168.107.4.6"])

        resolve.return_value = [SimpleNamespace(preference=10, exchange=TextAnswer("mx.example."))]
        self.assertEqual(resolver.resolve("example", "MX"), ["10 mx.example"])

        resolve.return_value = [SimpleNamespace(strings=[b"v=spf1 ", b"~all"])]
        self.assertEqual(resolver.resolve("example", "TXT"), ["v=spf1 ~all"])

        resolve.return_value = [TextAnswer("mail.example.")]
        self.assertEqual(resolver.reverse("168.107.4.6"), ["mail.example"])

    @patch("dns.resolver.resolve", side_effect=dns.resolver.NXDOMAIN)
    def test_dns_python_resolver_returns_empty_for_missing_name(self, _resolve) -> None:
        resolver = DnsPythonResolver()
        self.assertEqual(resolver.resolve("missing.example", "A"), [])
        self.assertEqual(resolver.reverse("192.0.2.1"), [])

    @patch("dns.resolver.resolve", side_effect=dns.exception.Timeout)
    def test_dns_python_resolver_reports_timeout_without_false_pass(self, _resolve) -> None:
        resolver = DnsPythonResolver()
        with self.assertRaises(DnsLookupError):
            resolver.resolve("example", "MX")
        with self.assertRaises(DnsLookupError):
            resolver.reverse("192.0.2.1")

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

    def test_verification_uses_configured_mail_host_domain_and_dkim_selector(self) -> None:
        resolver = FakeDnsResolver({
            ("mx.dev.moaworks.sinsan.kr", "A"): ["168.107.4.6"],
            ("dev.moaworks.sinsan.kr", "MX"): ["10 mx.dev.moaworks.sinsan.kr"],
            ("dev.moaworks.sinsan.kr", "TXT"): ["v=spf1 ip4:168.107.4.6 ~all"],
            ("mw202608._domainkey.dev.moaworks.sinsan.kr", "TXT"): ["v=DKIM1; k=rsa; p=PUBLIC"],
            ("_dmarc.dev.moaworks.sinsan.kr", "TXT"): ["v=DMARC1; p=none"],
            ("168.107.4.6", "PTR"): ["mx.dev.moaworks.sinsan.kr"],
        })

        result = DomainService(FakeStore(), resolver=resolver).verify(
            "dev.moaworks.sinsan.kr",
            managed_domain="dev.moaworks.sinsan.kr",
            mail_host="mx.dev.moaworks.sinsan.kr",
            dkim_selector="mw202608",
        )

        self.assertEqual(result.overallStatus, "pass")
        self.assertIn(("mx.dev.moaworks.sinsan.kr", "A"), resolver.calls)
        self.assertIn(("mw202608._domainkey.dev.moaworks.sinsan.kr", "TXT"), resolver.calls)

    @patch("app.api.routes.admin.MailAdminOperations")
    @patch("app.api.routes.admin.DomainService")
    def test_admin_verification_uses_active_mail_operations_contract(self, domain_service, operations) -> None:
        operations.return_value.get_overview.return_value = {
            "domain": {
                "mailDomain": "dev.moaworks.sinsan.kr",
                "mailHost": "mx.dev.moaworks.sinsan.kr",
                "activeOutboundProvider": "self_hosted",
            },
            "providers": [
                {
                    "providerKey": "oci_email_delivery",
                    "active": True,
                    "dkimSelector": "oci202608",
                },
                {
                    "providerKey": "self_hosted",
                    "active": False,
                    "dkimSelector": "mw202608",
                },
            ],
        }
        expected = MagicMock()
        domain_service.return_value.verify.return_value = expected

        result = verify_domain(
            DomainVerifyRequest(domain="dev.moaworks.sinsan.kr"),
            SimpleNamespace(companyId="company-1"),
        )

        self.assertIs(result, expected)
        domain_service.return_value.verify.assert_called_once_with(
            "dev.moaworks.sinsan.kr",
            managed_domain="dev.moaworks.sinsan.kr",
            mail_host="mx.dev.moaworks.sinsan.kr",
            dkim_selector="mw202608",
        )

    def test_missing_records_are_not_reported_as_pass(self) -> None:
        result = DomainService(FakeStore(), resolver=FakeDnsResolver({})).verify("moaworks.sinsan.kr")

        self.assertEqual(result.overallStatus, "warning")
        self.assertTrue(all(item.status != "pass" for item in result.checks))
        self.assertTrue(any("조회되지" in item.message for item in result.checks))


if __name__ == "__main__":
    unittest.main()
