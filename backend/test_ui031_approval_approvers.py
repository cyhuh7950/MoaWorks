from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


class Ui031ApprovalApproverContractTests(unittest.TestCase):
    root = Path(__file__).parent

    @staticmethod
    def _actor(*, permissions: list[str]):
        from app.schemas.directory import AuthUserSummary

        return AuthUserSummary(
            userId="actor-user",
            companyId="company-a",
            userName="Actor",
            userEmail="actor@example.com",
            roleId="role-a",
            roleName="Role A",
            userType="user",
            status="active",
            permissions=permissions,
        )

    def _client(self, actor=None) -> TestClient:
        from app.api.dependencies import get_current_user
        from app.api.routes import approvals

        app = FastAPI()
        app.include_router(approvals.router, prefix="/api/v1/approvals")
        if actor is not None:
            app.dependency_overrides[get_current_user] = lambda: actor
        return TestClient(app, raise_server_exceptions=False)

    def test_static_route_precedes_document_route_and_requires_create_permission(self):
        source = (self.root / "app" / "api" / "routes" / "approvals.py").read_text(encoding="utf-8")
        static_marker = '@router.get("/approvers", response_model=ApprovalApproverListResponse)'
        dynamic_marker = '@router.get("/{document_id}",'

        self.assertIn(static_marker, source)
        self.assertLess(source.index(static_marker), source.index(dynamic_marker))
        route_section = source[source.index(static_marker):source.index(dynamic_marker)]
        self.assertIn('permission_required("approval:create")', route_section)
        self.assertIn("list_active_approval_approvers(user.userId)", route_section)

    def test_response_schema_exposes_only_approved_fields(self):
        from app.schemas.directory import ApprovalApproverListResponse, ApprovalApproverView

        view = ApprovalApproverView(
            userId="user-a",
            userName="User A",
            userEmail="user-a@example.com",
            departmentName="미지정",
        )
        response = ApprovalApproverListResponse(users=[view])

        self.assertEqual(
            response.model_dump(),
            {
                "users": [
                    {
                        "userId": "user-a",
                        "userName": "User A",
                        "userEmail": "user-a@example.com",
                        "departmentName": "미지정",
                    }
                ]
            },
        )

    def test_store_scopes_active_directory_rows_with_parameter_binding_and_stable_sort(self):
        from app.services.directory_store import DirectoryStore

        rows = [
            {
                "user_id": "user-a",
                "user_name": "Alpha",
                "user_email": "alpha@example.com",
                "department_name": "개발",
            },
            {
                "user_id": "user-b",
                "user_name": "Beta",
                "user_email": "beta@example.com",
                "department_name": "미지정",
            },
        ]

        class Cursor:
            def __init__(self):
                self.calls: list[tuple[str, tuple]] = []

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def execute(self, sql, params):
                self.calls.append((sql, params))

            def fetchall(self):
                return rows

        class Connection:
            def __init__(self, cursor):
                self.cursor_value = cursor

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def cursor(self):
                return self.cursor_value

        class Db:
            def __init__(self):
                self.cursor_value = Cursor()
                self.connection = Connection(self.cursor_value)

            def ensure_migrations_applied(self):
                return None

            def connect(self):
                return self.connection

        service = DirectoryStore()
        service.db = Db()
        service.get_user_summary = Mock(return_value=self._actor(permissions=["approval:create"]))

        response = service.list_active_approval_approvers("actor-user")

        service.get_user_summary.assert_called_once_with("actor-user")
        self.assertEqual([item.userId for item in response.users], ["user-a", "user-b"])
        self.assertEqual(response.users[1].departmentName, "미지정")
        self.assertEqual(len(service.db.cursor_value.calls), 1)
        sql, params = service.db.cursor_value.calls[0]
        normalized_sql = " ".join(sql.split()).lower()
        self.assertEqual(params, ("company-a",))
        self.assertNotIn("company-a", sql)
        self.assertIn("u.company_id = %s", normalized_sql)
        self.assertIn("u.status = 'active'", normalized_sql)
        self.assertIn("join roles r on r.id = u.role_id and r.company_id = u.company_id", normalized_sql)
        self.assertIn("r.status = 'active'", normalized_sql)
        self.assertIn("left join departments d on d.id = u.department_id and d.company_id = u.company_id", normalized_sql)
        self.assertIn("(u.department_id is null or d.status = 'active')", normalized_sql)
        self.assertIn("order by department_name asc, u.name asc, u.email asc", normalized_sql)
        for forbidden in (" insert ", " update ", " delete ", " audit_logs "):
            self.assertNotIn(forbidden, f" {normalized_sql} ")

    def test_http_requires_authentication(self):
        response = self._client().get("/api/v1/approvals/approvers")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "AUTH_REQUIRED")

    def test_http_rejects_actor_without_approval_create(self):
        from app.api.routes import approvals

        with patch.object(approvals, "DirectoryStore", return_value=SimpleNamespace()):
            response = self._client(self._actor(permissions=["approval:read"])).get("/api/v1/approvals/approvers")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "FORBIDDEN")

    def test_http_admin_returns_only_allowlisted_fields(self):
        from app.api.routes import approvals

        store = SimpleNamespace(
            list_active_approval_approvers=Mock(
                return_value={
                    "users": [
                        {
                            "userId": "user-a",
                            "userName": "User A",
                            "userEmail": "user-a@example.com",
                            "departmentName": "개발",
                            "passwordHash": "must-not-leak",
                            "permissions": ["admin:*"],
                        }
                    ]
                }
            )
        )
        with patch.object(approvals, "DirectoryStore", return_value=store):
            response = self._client(self._actor(permissions=["admin:*"])).get("/api/v1/approvals/approvers")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "users": [
                    {
                        "userId": "user-a",
                        "userName": "User A",
                        "userEmail": "user-a@example.com",
                        "departmentName": "개발",
                    }
                ]
            },
        )
        store.list_active_approval_approvers.assert_called_once_with("actor-user")


if __name__ == "__main__":
    unittest.main()
