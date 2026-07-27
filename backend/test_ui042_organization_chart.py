from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent


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
        self.assertIn('"workspace.organization.member_viewed"', detail)
        audit = detail[detail.index('"workspace.organization.member_viewed"'):] if "workspace.organization.member_viewed" in detail else ""
        self.assertNotIn('row["email"]', audit)
        self.assertNotIn('row["name"]', audit)
        self.assertNotIn("query", audit[:500])

    def test_no_ui042_migration_is_added(self) -> None:
        self.assertEqual(list((ROOT / "migrations").glob("044*organization*")), [])


if __name__ == "__main__":
    unittest.main()
