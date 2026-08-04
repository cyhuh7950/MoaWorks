import unittest

from app.main import app
from app.services.mail_operations_policy import build_mail_domain_contract


class MailAdminOperationsContractTest(unittest.TestCase):
    def test_domain_contract_canonicalizes_admin_cidrs(self) -> None:
        contract = build_mail_domain_contract(
            registered_domain="sinsan.kr",
            mail_domain="moaworks.sinsan.kr",
            admin_access_mode="restricted",
            admin_allowed_cidrs=["203.0.113.8/24", "2001:db8::1/64"],
        )

        self.assertEqual(contract.admin_allowed_cidrs, ("203.0.113.0/24", "2001:db8::/64"))

    def test_restricted_mode_requires_at_least_one_cidr(self) -> None:
        with self.assertRaisesRegex(ValueError, "CIDR"):
            build_mail_domain_contract(
                registered_domain="sinsan.kr",
                mail_domain="moaworks.sinsan.kr",
                admin_access_mode="restricted",
                admin_allowed_cidrs=[],
            )

    def test_admin_api_exposes_complete_mail_operations_boundary(self) -> None:
        paths = app.openapi()["paths"]
        expected = {
            "/api/v1/admin/mail-operations": "get",
            "/api/v1/admin/mail-operations/domain": "put",
            "/api/v1/admin/mail-operations/providers/{provider_key}": "put",
            "/api/v1/admin/mail-operations/providers/switch": "post",
            "/api/v1/admin/mail-operations/providers/rollback": "post",
            "/api/v1/admin/mail-operations/oci/suppressions/sync": "post",
        }
        for path, method in expected.items():
            with self.subTest(path=path):
                self.assertIn(path, paths)
                self.assertIn(method, paths[path])


if __name__ == "__main__":
    unittest.main()
