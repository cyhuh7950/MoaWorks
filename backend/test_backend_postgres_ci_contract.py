from __future__ import annotations

from pathlib import Path
import ast
import re
import shlex
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "backend-postgresql.yml"
DEF01_TEST = ROOT / "backend" / "test_content_operations_patch_help_postgres.py"
TEST_REQUIREMENTS = ROOT / "backend" / "requirements-test.txt"


class BackendPostgresCiContractTest(unittest.TestCase):
    def test_workflow_uses_postgresql_15_and_python_312(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("postgres:15-alpine", workflow)
        self.assertIn("pg_isready", workflow)
        self.assertIn("python-version: '3.12'", workflow)
        self.assertIn("pip install -r requirements-test.txt", workflow)

    def test_workflow_installs_pinned_test_dependencies_and_node24_actions(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        requirements = TEST_REQUIREMENTS.read_text(encoding="utf-8").splitlines()

        self.assertEqual(requirements, ["-r requirements.txt", "httpx==0.28.1", "pytest==8.4.2"])
        self.assertIn("actions/checkout@v5", workflow)
        self.assertIn("actions/setup-python@v6", workflow)
        self.assertIn("cache-dependency-path: backend/requirements-test.txt", workflow)
        self.assertIn("pip install -r requirements-test.txt", workflow)
        self.assertNotIn("actions/checkout@v4", workflow)
        self.assertNotIn("actions/setup-python@v5", workflow)

    def test_workflow_preserves_three_real_postgresql_checks(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("MOAWORKS_UI041_POSTGRES_INTEGRATION: '1'", workflow)
        self.assertIn("MOAWORKS_DEF01_POSTGRES_INTEGRATION: '1'", workflow)
        self.assertIn("test_ui041_postgres_contacts", workflow)
        self.assertIn("test_content_operations_patch_help_postgres", workflow)
        self.assertIn('test_mail_sender_display_mode.SenderDisplayModeMigrationPostgresTests', workflow)

    def test_full_regression_collects_pytest_and_reports_skip_reasons(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        commands = re.findall(r"^        run: (.+)$", workflow, re.MULTILINE)
        self.assertIn("python -m pytest -q -ra", commands)
        self.assertFalse(any("unittest discover" in command for command in commands))

    def test_live_database_flags_are_scoped_to_existing_integration_step(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        job, steps = workflow.split("    steps:\n", 1)
        flags = ("MOAWORKS_UI041_POSTGRES_INTEGRATION", "MOAWORKS_DEF01_POSTGRES_INTEGRATION")
        blocks = re.split(r"^      - name: ", steps, flags=re.MULTILINE)[1:]
        integration = [block for block in blocks if "run: python -m unittest " in block]
        self.assertEqual(len(integration), 1)
        for flag in flags:
            self.assertNotIn(flag, job)
            self.assertIn(f"          {flag}: '1'", integration[0])
            self.assertEqual(sum(flag in block for block in blocks), 1)

    def test_explicit_pg_step_covers_all_testcases_enabled_by_ci_postgres_flags(self) -> None:
        # 소스를 import하지 않아 DB 연결/테스트 decorator 실행 없이 기존 opt-in 대상을 찾는다.
        workflow = WORKFLOW.read_text(encoding="utf-8")
        commands = re.findall(r"^        run: (python -m unittest .+)$", workflow, re.MULTILINE)
        self.assertEqual(len(commands), 1)
        targets = set(shlex.split(commands[0])[3:])
        flags = {"MOAWORKS_UI041_POSTGRES_INTEGRATION", "MOAWORKS_DEF01_POSTGRES_INTEGRATION"}
        discovered = set()
        for path in (ROOT / "backend").glob("test_*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
            for node in tree.body:
                if not isinstance(node, ast.ClassDef):
                    continue
                if not any(isinstance(base, ast.Attribute) and base.attr == "TestCase"
                           and isinstance(base.value, ast.Name) and base.value.id == "unittest"
                           for base in node.bases):
                    continue
                for decorator in node.decorator_list:
                    if not (isinstance(decorator, ast.Call) and decorator.args
                            and isinstance(decorator.func, ast.Attribute)
                            and decorator.func.attr in {"skipUnless", "skipIf"}):
                        continue
                    constants = {value.value for value in ast.walk(decorator.args[0])
                                 if isinstance(value, ast.Constant) and isinstance(value.value, str)}
                    if constants & flags:
                        qualified = f"{path.stem}.{node.name}"
                        discovered.add(qualified)
                        self.assertTrue(path.stem in targets or qualified in targets,
                                        f"기존 CI PostgreSQL opt-in 검사 누락: {qualified}")
        self.assertIn("test_mail_sender_display_mode.SenderDisplayModeMigrationPostgresTests", discovered)

    def test_policy_dsn_targets_only_existing_ci_service_in_full_pytest_step(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        job, steps = workflow.split("    steps:\n", 1)
        blocks = re.split(r"^      - name: ", steps, flags=re.MULTILINE)[1:]
        full = [block for block in blocks if "run: python -m pytest -q -ra" in block]
        self.assertEqual(len(full), 1)
        self.assertNotIn("MOAWORKS_STAGE1_TEST_DSN", job)
        self.assertEqual(sum("MOAWORKS_STAGE1_TEST_DSN" in block for block in blocks), 1)
        self.assertIn("          MOAWORKS_STAGE1_TEST_DSN: postgresql://moaworks_ci:moaworks_ci_password@127.0.0.1:5432/moaworks_ci", full[0])
        self.assertNotIn("secrets.", full[0])

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
