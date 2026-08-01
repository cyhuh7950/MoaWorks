from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.api.router import api_router
from app.schemas.content_operations import ContentBulkStatus
from app.schemas.directory import DepartmentUpdateRequest, OrgImportApplyRequest, UserCreateRequest
from app.services.org_import_service import OrgImportService


class AdminInterfaceIntegrationContractTest(unittest.TestCase):
    def test_required_admin_routes_are_registered(self) -> None:
        registered = {(route.path, method) for route in api_router.routes for method in getattr(route, "methods", set())}
        expected = {
            ("/admin/departments/{department_id}", "PATCH"),
            ("/admin/departments/{department_id}", "DELETE"),
            ("/admin/roles/{role_id}", "DELETE"),
            ("/admin/users/{user_id}", "DELETE"),
            ("/admin/org-import/template", "GET"),
            ("/admin/org-import/validate", "POST"),
            ("/admin/org-import/apply", "POST"),
            ("/admin/content/messages", "GET"),
            ("/admin/content/help-policies", "GET"),
            ("/admin/mail-delivery/status", "GET"),
            ("/admin/mail-delivery/provider", "PATCH"),
        }
        self.assertTrue(expected.issubset(registered), expected - registered)

    def test_user_creation_requires_safe_explicit_password(self) -> None:
        with self.assertRaises(ValidationError):
            UserCreateRequest(name="테스트", loginId="test.user", password="short", departmentId="d", roleId="r")
        request = UserCreateRequest(
            name="테스트", loginId="test.user", password="safe-pass-123", departmentId="d", roleId="r"
        )
        self.assertEqual(request.loginId, "test.user")

    def test_update_and_apply_inputs_reject_invalid_values(self) -> None:
        with self.assertRaises(ValidationError):
            DepartmentUpdateRequest(status="deleted")
        with self.assertRaises(ValidationError):
            OrgImportApplyRequest(batchId="")
        with self.assertRaises(ValidationError):
            ContentBulkStatus(ids=["message-1"], status="unexpected")

    def test_org_import_template_contains_required_sheets(self) -> None:
        workbook = OrgImportService().build_template()
        self.assertGreater(len(workbook), 100)


if __name__ == "__main__":
    unittest.main()
