import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.api.routes.admin import create_role, update_role
from app.schemas.directory import AuthUserSummary, RoleCreateRequest, RoleUpdateRequest
from app.services.admin_access_policy import AdminAccessDecision, AdminAccessOperations
from app.services.admin_access_policy import evaluate_admin_access
from app.services.directory_store import DirectoryAdminActiveLimitError, DirectoryStore


class FakeCursor:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = iter(rows)
        self.queries: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def execute(self, query: str) -> None:
        self.queries.append(query)

    def fetchone(self):
        return next(self.rows, None)


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor


class FakeDb:
    def __init__(self, rows: list[dict]) -> None:
        self.cursor = FakeCursor(rows)

    def connect(self) -> FakeConnection:
        return FakeConnection(self.cursor)


class AdminAccessPolicyTest(unittest.TestCase):
    def test_role_create_and_update_map_active_limit_to_stable_409(self) -> None:
        actor = MagicMock(spec=AuthUserSummary)
        with patch.object(
            DirectoryStore,
            "create_role",
            side_effect=DirectoryAdminActiveLimitError("관리자 활성 계정은 최대 3개입니다."),
        ):
            with self.assertRaises(HTTPException) as create_context:
                create_role(
                    payload=RoleCreateRequest(name="QA 권한", permissions=["admin:*"]),
                    _=actor,
                )
        with patch.object(
            DirectoryStore,
            "update_role",
            side_effect=DirectoryAdminActiveLimitError("관리자 활성 계정은 최대 3개입니다."),
        ):
            with self.assertRaises(HTTPException) as update_context:
                update_role(
                    role_id="role-1",
                    payload=RoleUpdateRequest(permissions=["admin:*"]),
                    _=actor,
                )

        for context in (create_context, update_context):
            self.assertEqual(context.exception.status_code, 409)
            self.assertEqual(context.exception.detail["code"], "ADMIN_ACTIVE_LIMIT_REACHED")

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

    def test_internal_check_requires_token_and_enforces_decision(self) -> None:
        client = TestClient(app)
        path = "/api/v1/internal/admin-access/check"
        client_ip = {"X-MoaWorks-Client-IP": "203.0.113.10"}

        self.assertEqual(client.get(path, headers=client_ip).status_code, 401)
        with patch("app.api.routes.admin_access_internal.settings.admin_access_check_token", "test-token"):
            with patch.object(
                AdminAccessOperations,
                "check",
                return_value=AdminAccessDecision(True, "public", "public_mode"),
            ):
                allowed = client.get(path, headers={**client_ip, "X-MoaWorks-Admin-Access-Token": "test-token"})
            with patch.object(
                AdminAccessOperations,
                "check",
                return_value=AdminAccessDecision(False, "restricted", "cidr_not_allowed"),
            ):
                denied = client.get(path, headers={**client_ip, "X-MoaWorks-Admin-Access-Token": "test-token"})

        self.assertEqual(allowed.status_code, 204)
        self.assertEqual(denied.status_code, 403)

    def test_operations_use_bootstrap_policy_before_migration(self) -> None:
        operation = AdminAccessOperations(db=FakeDb([{"relation": None}]))
        with patch("app.services.admin_access_policy.settings.admin_access_bootstrap_mode", "private"):
            decision = operation.check("10.0.0.20")
        self.assertTrue(decision.allowed)

    def test_operations_prefer_latest_persisted_policy(self) -> None:
        db = FakeDb(
            [
                {"relation": "mail_domain_settings"},
                {"admin_access_mode": "restricted", "admin_allowed_cidrs": ["198.51.100.0/24"]},
            ]
        )
        decision = AdminAccessOperations(db=db).check("198.51.100.10")
        self.assertTrue(decision.allowed)
        self.assertEqual(len(db.cursor.queries), 2)


if __name__ == "__main__":
    unittest.main()
