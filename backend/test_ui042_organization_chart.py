from pathlib import Path
import unittest

from fastapi import HTTPException

from app.schemas.directory import AuthUserSummary
from app.services.workspace_service import WorkspaceService


ROOT = Path(__file__).resolve().parent


class FakeCursor:
    def __init__(self, results):
        self.results = list(results)
        self.executions = []
        self.current = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params):
        self.executions.append((" ".join(sql.split()), tuple(params)))
        self.current = self.results.pop(0) if self.results else None

    def fetchone(self):
        return self.current

    def fetchall(self):
        return list(self.current or [])


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commit_count += 1


class FakeDb:
    def __init__(self, results):
        self.cursor = FakeCursor(results)
        self.connection = FakeConnection(self.cursor)

    def connect(self):
        return self.connection


def actor() -> AuthUserSummary:
    return AuthUserSummary(
        userId="user-a", companyId="company-a", userName="Actor", userEmail="actor@example.test",
        roleId="role-a", roleName="User", userType="user", status="active", permissions=["profile:read"],
    )


def service_with(results) -> tuple[WorkspaceService, FakeDb]:
    service = object.__new__(WorkspaceService)
    database = FakeDb(results)
    service.db = database
    return service, database


class Ui042OrganizationChartTests(unittest.TestCase):
    def test_existing_directory_contract_is_preserved(self) -> None:
        routes = (ROOT / "app" / "api" / "routes" / "workspace.py").read_text(encoding="utf-8")
        service = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        self.assertIn("@router.get('/directory', response_model=WorkspaceDirectoryResponse)", routes)
        self.assertIn("def directory(self, user: AuthUserSummary) -> dict:", service)

    def test_dedicated_routes_reuse_profile_read_and_validate_query(self) -> None:
        routes = (ROOT / "app" / "api" / "routes" / "workspace.py").read_text(encoding="utf-8")
        for token in (
            "@router.get('/organization/departments')",
            "@router.get('/organization/members')",
            "@router.get('/organization/members/{user_id}')",
            'query: str = Query(default="", max_length=120)',
            'permission_required("profile:read")',
        ):
            self.assertIn(token, routes)

    def test_service_enforces_company_active_and_direct_department_boundaries(self) -> None:
        service = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        for token in (
            "def organization_departments",
            "def organization_members",
            "def organization_member_detail",
            "department.company_id=%s",
            "department.status='active'",
            "member.company_id=%s",
            "member.status='active'",
            "role.status='active'",
            "member.department_id=%s",
            "LOWER(member.name) LIKE LOWER(%s)",
            "LOWER(member.email) LIKE LOWER(%s)",
            "workspace.organization.member_viewed",
        ):
            self.assertIn(token, service)

    def test_member_detail_audit_excludes_pii(self) -> None:
        service = (ROOT / "app" / "services" / "workspace_service.py").read_text(encoding="utf-8")
        detail = service[service.index("def organization_member_detail"):] if "def organization_member_detail" in service else ""
        detail = detail[:detail.index("\n    def ", 1)] if "\n    def " in detail[1:] else detail
        self.assertIn('"workspace.organization.member_viewed"', detail)
        audit = detail[detail.index('"workspace.organization.member_viewed"'):] if "workspace.organization.member_viewed" in detail else ""
        self.assertNotIn('row["email"]', audit)
        self.assertNotIn('row["name"]', audit)
        self.assertNotIn("query", audit[:500])

    def test_no_ui042_migration_is_added(self) -> None:
        self.assertEqual(list((ROOT / "migrations").glob("044*organization*")), [])

    def test_departments_execute_query_and_map_design_response_key(self) -> None:
        service, database = service_with([[{
            "id": "dept-a", "name": "기획", "department_code": "PLAN", "parent_id": None, "direct_member_count": 2,
        }]])
        self.assertEqual(service.organization_departments(actor()), {"departments": [{
            "id": "dept-a", "name": "기획", "departmentCode": "PLAN", "parentId": None, "directMemberCount": 2,
        }]})
        sql, params = database.cursor.executions[0]
        self.assertIn("department.company_id=%s", sql)
        self.assertIn("department.status='active'", sql)
        self.assertEqual(params, ("company-a",))

    def test_members_validate_department_bind_search_and_map_design_response_key(self) -> None:
        service, database = service_with([{"id": "dept-a"}, [{
            "id": "user-b", "name": "Beta", "email": "beta@example.test", "department_id": "dept-a",
            "department_name": "기획", "role_name": "Member",
        }]])
        result = service.organization_members(actor(), "dept-a", "  beta  ")
        self.assertEqual(result["members"][0]["id"], "user-b")
        validation_sql, validation_params = database.cursor.executions[0]
        search_sql, search_params = database.cursor.executions[1]
        self.assertIn("department.company_id=%s", validation_sql)
        self.assertEqual(validation_params, ("dept-a", "company-a"))
        self.assertNotIn("beta", search_sql.lower())
        self.assertEqual(search_params, ("company-a", "dept-a", "beta", "%beta%", "%beta%"))

    def test_members_invalid_department_is_404_before_search(self) -> None:
        service, database = service_with([None])
        with self.assertRaises(HTTPException) as raised:
            service.organization_members(actor(), "foreign-dept", "")
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(len(database.cursor.executions), 1)
        self.assertEqual(database.connection.commit_count, 0)

    def test_detail_success_audits_once_without_pii_and_commits(self) -> None:
        row = {
            "id": "user-b", "name": "Beta", "email": "beta@example.test", "department_id": "dept-a",
            "department_name": "기획", "role_name": "Member",
        }
        service, database = service_with([row, None])
        self.assertEqual(service.organization_member_detail(actor(), "user-b")["email"], "beta@example.test")
        self.assertEqual(database.connection.commit_count, 1)
        self.assertEqual(len(database.cursor.executions), 2)
        audit_sql, audit_params = database.cursor.executions[1]
        self.assertIn("INSERT INTO audit_logs", audit_sql)
        self.assertIn("workspace.organization.member_viewed", audit_params)
        audit_metadata = str(audit_params[-1])
        self.assertNotIn("Beta", audit_metadata)
        self.assertNotIn("beta@example.test", audit_metadata)
        self.assertNotIn("query", audit_metadata)

    def test_detail_missing_does_not_audit_or_commit(self) -> None:
        service, database = service_with([None])
        with self.assertRaises(HTTPException) as raised:
            service.organization_member_detail(actor(), "missing-user")
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(len(database.cursor.executions), 1)
        self.assertEqual(database.connection.commit_count, 0)


if __name__ == "__main__":
    unittest.main()
