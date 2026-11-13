from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.directory_store import DirectoryStore


ROOT = Path(__file__).resolve().parent


def test_password_reset_migration_adds_session_version():
    migration = (ROOT / "migrations" / "064_admin_password_reset.sql").read_text(encoding="utf-8")
    assert "auth_session_version" in migration
    assert "must_change_password" in migration


def test_admin_route_exposes_one_time_reset_endpoint():
    source = (ROOT / "app" / "api" / "routes" / "admin.py").read_text(encoding="utf-8")
    assert '@router.post("/users/{user_id}/password-reset"' in source
    assert "require_admin" in source
    schema = (ROOT / "app" / "schemas" / "directory.py").read_text(encoding="utf-8")
    assert "temporaryPassword" not in schema


def test_reset_contract_does_not_log_plaintext_password():
    source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
    assert "admin.user.password_reset" in source
    reset_method = source.split("def reset_user_password(", 1)[1].split("def _fetch_user_view_row(", 1)[0]
    assert 'target["email"].split("@", 1)[0]' in reset_method
    assert "temporary_password" not in reset_method
    assert "must_change_password=TRUE" in reset_method
    assert "auth_session_version" in reset_method


def test_admin_reset_uses_login_id_as_initial_password_without_returning_it():
    store = DirectoryStore.__new__(DirectoryStore)
    store.db = MagicMock()
    store.security = MagicMock()
    store.security.hash_password.return_value = "hashed-id"
    store._insert_audit = MagicMock()
    connection = store.db.connect.return_value.__enter__.return_value
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = {
        "email": "SinSan@moaworks.sinsan.kr",
        "auth_session_version": 4,
        "must_change_password": False,
    }
    actor = SimpleNamespace(companyId="company", userId="admin", userName="Admin")

    result = store.reset_user_password(actor, "target-user")

    store.security.hash_password.assert_called_once_with("sinsan")
    assert cursor.execute.call_args_list[1].args[1] == ("hashed-id", 5, "target-user", "company")
    assert result == {"userId": "target-user", "mustChangePassword": True, "sessionsRevoked": True}
    connection.commit.assert_called_once()


def test_auth_summary_carries_must_change_password_for_user_web_gate():
    schema = (ROOT / "app" / "schemas" / "directory.py").read_text(encoding="utf-8")
    store = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
    assert "mustChangePassword: bool" in schema
    assert "mustChangePassword=bool(row.get(\"must_change_password\", False))" in store


def test_change_password_returns_fresh_user_summary():
    service = (ROOT / "app" / "services" / "auth_service.py").read_text(encoding="utf-8")
    assert "return PasswordChangeResponse(message=\"비밀번호를 변경했습니다.\", user=self.store.get_user_summary(user.userId))" in service


def test_admin_web_has_reset_api_and_action():
    api = (ROOT.parent / "frontend" / "admin-web" / "src" / "api.ts").read_text(encoding="utf-8")
    app = (ROOT.parent / "frontend" / "admin-web" / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "resetUserPassword" in api
    assert "/password-reset" in api
    assert "비밀번호 재설정" in app
