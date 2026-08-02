from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "backend-postgresql.yml"
DEF01_TEST = ROOT / "backend" / "test_content_operations_patch_help_postgres.py"


class BackendPostgresCiContractTest(unittest.TestCase):
    def test_workflow_uses_postgresql_15_and_python_312(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("postgres:15-alpine", workflow)
        self.assertIn("pg_isready", workflow)
        self.assertIn("python-version: '3.12'", workflow)
        self.assertIn("pip install -r requirements.txt", workflow)

    def test_workflow_enables_both_real_postgresql_suites(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("MOAWORKS_UI041_POSTGRES_INTEGRATION: '1'", workflow)
        self.assertIn("MOAWORKS_DEF01_POSTGRES_INTEGRATION: '1'", workflow)
        self.assertIn("test_ui041_postgres_contacts", workflow)
        self.assertIn("test_content_operations_patch_help_postgres", workflow)
        self.assertIn('python -m unittest discover -s . -p "test_*.py"', workflow)

    def test_workflow_is_scoped_to_backend_and_its_own_file(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("backend/**", workflow)
        self.assertIn(".github/workflows/backend-postgresql.yml", workflow)
        self.assertIn("working-directory: backend", workflow)

    def test_def01_integration_test_executes_service_with_temp_tables_and_rollback(self) -> None:
        integration_test = DEF01_TEST.read_text(encoding="utf-8")

        self.assertIn("MOAWORKS_DEF01_POSTGRES_INTEGRATION", integration_test)
        self.assertIn("CREATE TEMP TABLE help_policy_documents", integration_test)
        self.assertIn("CREATE TEMP TABLE audit_logs", integration_test)
        self.assertIn("CREATE TEMP TABLE users", integration_test)
        self.assertIn("service.patch_help", integration_test)
        self.assertIn("content.help.updated", integration_test)
        self.assertIn("connection.rollback()", integration_test)


if __name__ == "__main__":
    unittest.main()
