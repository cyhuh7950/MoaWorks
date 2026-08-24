from pathlib import Path


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
    assert "temporaryPassword" in schema


def test_reset_contract_does_not_log_plaintext_password():
    source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
    assert "admin.user.password_reset" in source
    assert "temporary_password" in source
    assert 'reason="temporary_password' not in source


def test_admin_web_has_reset_api_and_action():
    api = (ROOT.parent / "frontend" / "admin-web" / "src" / "api.ts").read_text(encoding="utf-8")
    app = (ROOT.parent / "frontend" / "admin-web" / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "resetUserPassword" in api
    assert "/password-reset" in api
    assert "비밀번호 재설정" in app
