from __future__ import annotations

import unittest

from app.services.directory_store import DirectoryStore


class AdminDirectoryResponseTest(unittest.TestCase):
    def test_user_view_includes_department_head_flag(self) -> None:
        store = DirectoryStore.__new__(DirectoryStore)
        row = {
            "user_id": "user-1",
            "company_id": "company-1",
            "user_name": "관리자",
            "user_email": "admin@example.com",
            "department_id": "department-1",
            "department_name": "본사",
            "role_id": "role-1",
            "role_name": "관리자",
            "role_status": "active",
            "user_status": "active",
            "user_type": "admin",
            "is_department_head": True,
            "mail_account_email": "admin@example.com",
            "mail_account_status": "active",
            "permissions": ["admin"],
        }

        view = store._row_to_user_view(row)

        self.assertTrue(view.isDepartmentHead)


if __name__ == "__main__":
    unittest.main()
