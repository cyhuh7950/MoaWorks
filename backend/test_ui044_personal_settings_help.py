from pathlib import Path

import pytest
from pydantic import ValidationError
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parent


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_migration_045_is_additive_idempotent_and_preserves_existing_rows():
    sql = read("migrations/045_personal_settings_help.sql")
    for marker in (
        "CREATE TABLE IF NOT EXISTS user_workspace_preferences",
        "CREATE TABLE IF NOT EXISTS help_policy_documents",
        "ADD COLUMN IF NOT EXISTS company_id",
        "ADD COLUMN IF NOT EXISTS start_page",
        "ADD COLUMN IF NOT EXISTS version",
        "ON CONFLICT(code) DO NOTHING",
        "ix_help_policy_documents_public",
    ):
        assert marker in sql
    upper = sql.upper()
    assert "DROP TABLE" not in upper
    assert "TRUNCATE" not in upper
    assert "DELETE FROM" not in upper
    assert "DO UPDATE" not in upper


def test_preferences_schema_whitelists_locale_timezone_start_page_and_version():
    from app.schemas.workspace import PreferencePayload

    payload = PreferencePayload(locale="ko-KR", timezone="Asia/Seoul", startPage="mail", expectedVersion=0)
    assert payload.startPage == "mail"
    for invalid in (
        {"locale": "ko", "timezone": "Asia/Seoul", "startPage": "home", "expectedVersion": 0},
        {"locale": "ko-KR", "timezone": "Mars/Base", "startPage": "home", "expectedVersion": 0},
        {"locale": "ko-KR", "timezone": "Asia/Seoul", "startPage": "admin", "expectedVersion": 0},
        {"locale": "ko-KR", "timezone": "Asia/Seoul", "startPage": "home", "expectedVersion": -1},
    ):
        with pytest.raises(ValidationError):
            PreferencePayload(**invalid)


def test_password_schema_rejects_short_long_and_same_values():
    from app.schemas.auth import PasswordChangeRequest

    assert PasswordChangeRequest(currentPassword="current-value", newPassword="new-value").newPassword == "new-value"
    for invalid in (
        {"currentPassword": "current-value", "newPassword": "short"},
        {"currentPassword": "same-value", "newPassword": "same-value"},
        {"currentPassword": "current-value", "newPassword": "x" * 129},
    ):
        with pytest.raises(ValidationError):
            PasswordChangeRequest(**invalid)


def test_workspace_routes_expose_self_scoped_profile_preferences_and_filtered_help():
    source = read("app/api/routes/workspace.py")
    for marker in (
        "@router.get('/profile'",
        "@router.get('/preferences'",
        "@router.put('/preferences'",
        "@router.get('/help-policies'",
        "query: str = Query",
        "category: str | None = Query",
    ):
        assert marker in source
    assert "permission_required(\"profile:read\")" in source


def test_workspace_service_has_default_no_write_version_lock_audience_and_safe_audit():
    source = read("app/services/workspace_service.py")
    for marker in (
        "def profile",
        "workspace.profile.viewed",
        '"startPage":"home"',
        "payload.expectedVersion",
        "WORKSPACE_PREFERENCES_CONFLICT",
        "workspace.preferences.viewed",
        "workspace.preferences.updated",
        "audience IN ('user','both','all')",
        "workspace.help.viewed",
        "LOWER(title)",
    ):
        assert marker in source


def test_change_password_is_self_only_rate_limited_and_never_returns_secrets():
    route = read("app/api/routes/auth.py")
    service = read("app/services/auth_service.py")
    for marker in (
        '@router.post("/change-password"',
        "Depends(get_current_user)",
        "auth.password.change_failed",
        "auth.password.changed",
        "INTERVAL '15 minutes'",
        "AUTH_PASSWORD_RATE_LIMITED",
        "verify_password",
        "hash_password",
        "UPDATE users SET password_hash=%s,updated_at=NOW()",
    ):
        assert marker in f"{route}\n{service}"
    response_block = service[service.index("def change_password"):]
    assert '"password"' not in response_block
    assert '"passwordHash"' not in response_block


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.executed = []
        self.rowcount = 1
        self.current = None

    def __enter__(self): return self
    def __exit__(self, *_): return False
    def execute(self, sql, params=()):
        self.executed.append((" ".join(sql.split()), params))
        self.current = self.rows.pop(0) if sql.lstrip().upper().startswith("SELECT") and self.rows else None
    def fetchone(self): return self.current
    def fetchall(self): return self.current or []


class FakeConnection:
    def __init__(self, cursor): self.value = cursor; self.commits = 0
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def cursor(self): return self.value
    def commit(self): self.commits += 1


class FakeDb:
    def __init__(self, cursor): self.connection = FakeConnection(cursor)
    def connect(self): return self.connection


def actor():
    from app.schemas.directory import AuthUserSummary
    return AuthUserSummary(userId="usr_1", companyId="cmp_1", userName="사용자", userEmail="user@example.invalid", roleId="role_1", roleName="사용자", userType="user", status="active", permissions=["profile:read"])


def test_default_preferences_do_not_create_preference_row_and_are_audited():
    from app.services.workspace_service import WorkspaceService
    cursor = FakeCursor([None])
    service = WorkspaceService.__new__(WorkspaceService)
    service.db = FakeDb(cursor)
    result = service.get_preferences(actor())
    assert result == {"locale": "ko-KR", "timezone": "Asia/Seoul", "startPage": "home", "version": 0}
    assert not any("INSERT INTO user_workspace_preferences" in sql for sql, _ in cursor.executed)
    assert any("workspace.preferences.viewed" in params for _, params in cursor.executed if isinstance(params, tuple))


def test_preference_version_conflict_returns_stable_409_without_update():
    from app.schemas.workspace import PreferencePayload
    from app.services.workspace_service import WorkspaceService
    cursor = FakeCursor([{"locale": "ko-KR", "timezone": "Asia/Seoul", "start_page": "home", "version": 2}])
    service = WorkspaceService.__new__(WorkspaceService)
    service.db = FakeDb(cursor)
    with pytest.raises(HTTPException) as caught:
        service.save_preferences(actor(), PreferencePayload(locale="en-US", timezone="Europe/Paris", startPage="mail", expectedVersion=1))
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "WORKSPACE_PREFERENCES_CONFLICT"
    assert not any(sql.startswith("UPDATE user_workspace_preferences") for sql, _ in cursor.executed)


class FakeSecurity:
    def __init__(self, valid): self.valid = valid
    def verify_password(self, *_): return self.valid
    def hash_password(self, _): return "safe-hash"


class FakeStore:
    def __init__(self, cursor, valid): self.db = FakeDb(cursor); self.security = FakeSecurity(valid); self.audits = []
    def _insert_audit(self, **kwargs): self.audits.append(kwargs); kwargs["cursor"].execute("INSERT INTO audit_logs(event) VALUES(%s)", (kwargs["event"],))


def test_password_failure_is_audited_without_secret_and_rate_limit_is_shared_db():
    from app.schemas.auth import PasswordChangeRequest
    from app.services.auth_service import AuthService
    from app.services.token_service import TokenService
    cursor = FakeCursor([{"password_hash": "stored-hash", "status": "active"}, {"count": 0}])
    store = FakeStore(cursor, False)
    service = AuthService(store, TokenService())
    with pytest.raises(HTTPException) as caught:
        service.change_password(actor(), PasswordChangeRequest(currentPassword="current-value", newPassword="new-value"))
    assert caught.value.detail["code"] == "AUTH_CURRENT_PASSWORD_INVALID"
    assert store.audits[0]["reason"] == "current_password_mismatch"
    assert all("current-value" not in str(value) and "new-value" not in str(value) for value in store.audits[0].values())
    assert any("INTERVAL '15 minutes'" in sql for sql, _ in cursor.executed)


def test_password_success_hashes_before_update_and_returns_no_secret_fields():
    from app.schemas.auth import PasswordChangeRequest
    from app.services.auth_service import AuthService
    from app.services.token_service import TokenService
    cursor = FakeCursor([{"password_hash": "stored-hash", "status": "active"}, {"count": 0}])
    store = FakeStore(cursor, True)
    response = AuthService(store, TokenService()).change_password(actor(), PasswordChangeRequest(currentPassword="current-value", newPassword="new-value"))
    update = next(params for sql, params in cursor.executed if sql.startswith("UPDATE users SET password_hash"))
    assert update[0] == "safe-hash"
    serialized = response.model_dump()
    assert "password" not in str(serialized).lower()
    assert store.audits[0]["event"] == "auth.password.changed"


@pytest.mark.parametrize(("category", "expected_parameter_count"), [("error", 5), (None, 4)])
def test_help_category_uses_dynamic_typed_clause(category, expected_parameter_count):
    from app.services.workspace_service import WorkspaceService

    cursor = FakeCursor([[]])
    service = WorkspaceService.__new__(WorkspaceService)
    service.db = FakeDb(cursor)
    service.list_help(actor(), "ERROR", category)
    select_sql, params = next((sql, params) for sql, params in cursor.executed if sql.startswith("SELECT id,code,title"))
    assert "%s IS NULL" not in select_sql
    assert ("AND category=%s" in select_sql) is (category is not None)
    assert len(params) == expected_parameter_count
    if category is not None:
        assert params[-1] == category
