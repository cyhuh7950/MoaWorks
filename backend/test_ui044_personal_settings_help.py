from pathlib import Path

import pytest
from pydantic import ValidationError


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

