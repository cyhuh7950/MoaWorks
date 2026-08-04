import unittest
from pathlib import Path

from app.services.admin_access_policy import evaluate_admin_access


class AdminAccessPolicyTest(unittest.TestCase):
    def test_public_mode_allows_public_client(self) -> None:
        decision = evaluate_admin_access("public", [], "203.0.113.10")
        self.assertTrue(decision.allowed)

    def test_restricted_mode_requires_matching_cidr(self) -> None:
        allowed = evaluate_admin_access("restricted", ["203.0.113.0/24"], "203.0.113.10")
        denied = evaluate_admin_access("restricted", ["203.0.113.0/24"], "198.51.100.10")
        self.assertTrue(allowed.allowed)
        self.assertFalse(denied.allowed)

    def test_private_mode_allows_only_private_or_loopback_client(self) -> None:
        self.assertTrue(evaluate_admin_access("private", [], "10.0.0.20").allowed)
        self.assertTrue(evaluate_admin_access("private", [], "127.0.0.1").allowed)
        self.assertFalse(evaluate_admin_access("private", [], "203.0.113.10").allowed)

    def test_invalid_ip_cidr_and_mode_fail_closed(self) -> None:
        for mode, cidrs, address in (
            ("unknown", [], "203.0.113.10"),
            ("restricted", ["bad-cidr"], "203.0.113.10"),
            ("public", [], "not-an-ip"),
        ):
            with self.subTest(mode=mode, address=address):
                self.assertFalse(evaluate_admin_access(mode, cidrs, address).allowed)

    def test_admin_nginx_uses_internal_auth_request_not_browser_api(self) -> None:
        root = Path(__file__).parents[1]
        config = (root / "deploy" / "admin-web.nginx.conf").read_text(encoding="utf-8")
        compose = (root / "deploy" / "docker-compose.oracle.yml").read_text(encoding="utf-8")

        self.assertIn("auth_request /_admin_access_check", config)
        self.assertIn("location = /_admin_access_check", config)
        self.assertIn("internal;", config)
        self.assertIn("X-MoaWorks-Admin-Access-Token", config)
        self.assertIn("ADMIN_ACCESS_CHECK_TOKEN", compose)


if __name__ == "__main__":
    unittest.main()
