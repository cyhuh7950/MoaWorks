from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, datetime
import os
from pathlib import Path
import tempfile
import threading
from typing import Any
import uuid

import pytest
from cryptography.exceptions import InvalidTag
from psycopg import sql

from app.core.config import Settings, settings
from app.schemas.setup import DbConfigPayload
from app.services.postgres_service import PostgresService
from app.services.admin_mfa_service import (
    AdminMfaConfigurationError,
    AdminMfaNonceReuseError,
    AdminMfaService,
)


def _key(byte: int) -> bytes:
    return bytes([byte]) * 32


def _service(*, nonces: list[bytes] | None = None) -> AdminMfaService:
    nonce_values = iter(nonces or [bytes.fromhex("00112233445566778899aabb")])
    return AdminMfaService(
        totp_current_key_version=2,
        totp_keys={1: _key(1), 2: _key(2)},
        otp_current_key_version=7,
        otp_hmac_keys={7: _key(7)},
        recovery_current_key_version=9,
        recovery_hmac_keys={9: _key(9)},
        nonce_factory=lambda: next(nonce_values),
    )


def test_email_otp_mac_is_bound_to_version_purpose_challenge_user_and_email() -> None:
    service = _service()
    expected = service.email_otp_mac(
        key_version=7,
        purpose="recovery",
        challenge_id="challenge-a",
        user_id="user-a",
        email=" Safe@Example.Test ",
        code="123456",
    )

    assert service.email_otp_matches(
        expected,
        key_version=7,
        purpose="recovery",
        challenge_id="challenge-a",
        user_id="user-a",
        email="safe@example.test",
        code="123456",
    )
    for changed in (
        {"purpose": "login"},
        {"challenge_id": "challenge-b"},
        {"user_id": "user-b"},
        {"email": "other@example.test"},
        {"code": "654321"},
    ):
        values = {
            "key_version": 7,
            "purpose": "recovery",
            "challenge_id": "challenge-a",
            "user_id": "user-a",
            "email": "safe@example.test",
            "code": "123456",
            **changed,
        }
        assert not service.email_otp_matches(expected, **values)


def test_recovery_code_uses_separate_key_and_profile_user_binding() -> None:
    service = _service()
    recovery_mac = service.recovery_code_mac("profile-a", "user-a", "code-a")
    otp_mac = service.email_otp_mac(
        key_version=7,
        purpose="recovery",
        challenge_id="profile-a",
        user_id="user-a",
        email="safe@example.test",
        code="code-a",
    )

    assert recovery_mac.keyVersion == 9
    assert recovery_mac.mac != otp_mac.mac
    assert service.recovery_code_matches(
        recovery_mac.mac,
        key_version=9,
        profile_id="profile-a",
        user_id="user-a",
        code="code-a",
    )
    assert not service.recovery_code_matches(
        recovery_mac.mac,
        key_version=9,
        profile_id="profile-b",
        user_id="user-a",
        code="code-a",
    )


def test_recovery_codes_have_at_least_128_bits_and_are_unique() -> None:
    codes = _service().generate_recovery_codes(count=10)
    assert len(codes) == len(set(codes)) == 10
    for code in codes:
        decoded = base64.urlsafe_b64decode(code + "=" * (-len(code) % 4))
        assert len(decoded) >= 16


def test_totp_seed_encrypts_with_current_key_and_old_key_remains_decryptable() -> None:
    service = _service(nonces=[bytes.fromhex("00112233445566778899aabb")])
    encrypted = service.encrypt_totp_seed("profile-a", "user-a", b"seed-material")

    assert encrypted.keyVersion == 2
    assert encrypted.nonce == bytes.fromhex("00112233445566778899aabb")
    assert service.decrypt_totp_seed("profile-a", "user-a", encrypted) == b"seed-material"

    old = AdminMfaService(
        totp_current_key_version=1,
        totp_keys={1: _key(1)},
        otp_current_key_version=7,
        otp_hmac_keys={7: _key(7)},
        recovery_current_key_version=9,
        recovery_hmac_keys={9: _key(9)},
        nonce_factory=lambda: bytes.fromhex("102132435465768798a9bacb"),
    ).encrypt_totp_seed("profile-old", "user-a", b"old-seed")
    assert service.decrypt_totp_seed("profile-old", "user-a", old) == b"old-seed"


def test_totp_seed_rejects_aad_changes_tag_tampering_and_nonce_reuse() -> None:
    nonce = bytes.fromhex("00112233445566778899aabb")
    service = _service(nonces=[nonce, nonce])
    encrypted = service.encrypt_totp_seed("profile-a", "user-a", b"seed-material")

    with pytest.raises(InvalidTag):
        service.decrypt_totp_seed("profile-b", "user-a", encrypted)
    with pytest.raises(InvalidTag):
        service.decrypt_totp_seed(
            "profile-a",
            "user-a",
            encrypted.model_copy(update={"tag": bytes([encrypted.tag[0] ^ 1]) + encrypted.tag[1:]}),
        )
    with pytest.raises(AdminMfaNonceReuseError):
        service.encrypt_totp_seed("profile-b", "user-b", b"another-seed")


def test_totp_accepts_window_once_and_rejects_wrong_or_replayed_step() -> None:
    service = _service()
    seed = b"12345678901234567890"
    now = datetime(2026, 8, 29, 12, 0, 0, tzinfo=UTC)
    code = service.totp_code(seed, at=now)
    accepted_step = service.verify_totp(seed, code, at=now, last_accepted_step=None)

    assert accepted_step is not None
    assert service.verify_totp(seed, code, at=now, last_accepted_step=accepted_step) is None
    assert service.verify_totp(seed, "000000", at=now, last_accepted_step=None) is None


def test_qr_payload_is_png_and_has_no_store_headers_without_returning_uri() -> None:
    payload = _service().build_totp_qr_png(
        account_name="admin@moaworks.sinsan.kr",
        issuer="MoaWorks",
        secret=b"12345678901234567890",
    )

    assert payload.pngBytes.startswith(b"\x89PNG\r\n\x1a\n")
    assert payload.headers == {
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
    }
    assert not hasattr(payload, "otpauthUri")
    assert b"otpauth" not in repr(payload).encode("utf-8")


@pytest.mark.parametrize("enforcement, endpoint_used", [("required", False), ("optional", True)])
def test_missing_or_placeholder_secret_configuration_fails_closed(
    enforcement: str,
    endpoint_used: bool,
) -> None:
    with pytest.raises(AdminMfaConfigurationError):
        AdminMfaService.from_encoded_secrets(
            enforcement=enforcement,
            endpoint_used=endpoint_used,
            totp_current_key_version=1,
            totp_keyring="",
            otp_hmac_keyring="change-me",
            recovery_hmac_keyring="",
        )


def test_secret_values_are_redacted_from_repr() -> None:
    service = _service()
    rendered = repr(service)
    assert "010101" not in rendered
    assert "070707" not in rendered
    assert "090909" not in rendered


def test_settings_repr_does_not_expose_mfa_secret_values() -> None:
    secret_value = base64.b64encode(_key(3)).decode("ascii")
    configured = Settings(
        admin_mfa_totp_keyring=f'{{"1":"{secret_value}"}}',
        admin_mfa_otp_hmac_key=secret_value,
        admin_mfa_recovery_code_hmac_key=secret_value,
        admin_mfa_break_glass_approver_keyring=secret_value,
    )
    assert secret_value not in repr(configured)


MIGRATION = Path(__file__).parent / "migrations" / "068_admin_mfa_and_active_limit.sql"
POSTGRES_OPT_IN = "MOAWORKS_UI041_POSTGRES_INTEGRATION"
MFA_TABLE_DROP_ORDER = (
    "admin_mfa_break_glass_approvals",
    "admin_mfa_break_glass_requests",
    "admin_mfa_recovery_codes",
    "admin_mfa_invitations",
    "admin_mfa_challenges",
    "admin_mfa_profiles",
    "admin_mfa_policy",
)


@dataclass(frozen=True)
class MfaDbFixture:
    prefix: str
    profile_id: str
    user_id: str
    service: AdminMfaService


def _db_config() -> DbConfigPayload:
    return DbConfigPayload(
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )


@pytest.fixture(scope="module")
def mfa_db() -> MfaDbFixture:
    if os.getenv(POSTGRES_OPT_IN) != "1":
        pytest.skip(f"set {POSTGRES_OPT_IN}=1 to use the existing PostgreSQL runtime")

    connection = PostgresService().connect(_db_config())
    prefix = f"task8_{uuid.uuid4().hex}"
    company_id = f"{prefix}_company"
    department_id = f"{prefix}_department"
    role_id = f"{prefix}_role"
    user_id = f"{prefix}_user"
    profile_id = f"{prefix}_profile"
    prior_status_constraints: list[tuple[str, str]] = []
    migration_applied = False
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) AS count FROM schema_migrations WHERE version = %s",
                (MIGRATION.name,),
            )
            assert cursor.fetchone()["count"] == 0
            cursor.execute(
                """
                SELECT conname, pg_get_constraintdef(oid) AS definition
                FROM pg_constraint
                WHERE conrelid = 'public.users'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) ILIKE '%%status%%'
                ORDER BY conname
                """
            )
            prior_status_constraints = [
                (row["conname"], row["definition"]) for row in cursor.fetchall()
            ]
        connection.rollback()

        with tempfile.TemporaryDirectory(prefix="moaworks-task8-migration-") as temp_dir:
            migration_copy = Path(temp_dir) / MIGRATION.name
            migration_copy.write_text(MIGRATION.read_text(encoding="utf-8"), encoding="utf-8")
            PostgresService(migration_dir=migration_copy.parent).ensure_migrations_applied(
                db_config=_db_config()
            )
            migration_applied = True

        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO companies (id, name, domain, status, created_at) "
                "VALUES (%s, %s, %s, 'active', statement_timestamp())",
                (company_id, "Task 8 fixture", f"{prefix}.invalid"),
            )
            cursor.execute(
                "INSERT INTO departments (id, company_id, name, status, sort_order, created_at) "
                "VALUES (%s, %s, %s, 'active', 100, statement_timestamp())",
                (department_id, company_id, "Task 8 fixture"),
            )
            cursor.execute(
                "INSERT INTO roles (id, company_id, name, permissions, status, created_at) "
                "VALUES (%s, %s, %s, '[]'::jsonb, 'active', statement_timestamp())",
                (role_id, company_id, "Task 8 fixture"),
            )
            cursor.execute(
                """
                INSERT INTO users (
                    id, company_id, email, name, password_hash, department_id, role_id,
                    status, user_type, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', 'user',
                          statement_timestamp(), statement_timestamp())
                """,
                (
                    user_id,
                    company_id,
                    f"{user_id}@{prefix}.invalid",
                    "Task 8 user",
                    "fixture-hash",
                    department_id,
                    role_id,
                ),
            )
            cursor.execute(
                "INSERT INTO admin_mfa_profiles (id, user_id) VALUES (%s, %s)",
                (profile_id, user_id),
            )
        connection.commit()

        yield MfaDbFixture(
            prefix=prefix,
            profile_id=profile_id,
            user_id=user_id,
            service=AdminMfaService(
                totp_current_key_version=2,
                totp_keys={1: _key(1), 2: _key(2)},
                otp_current_key_version=7,
                otp_hmac_keys={7: _key(7)},
                recovery_current_key_version=9,
                recovery_hmac_keys={9: _key(9)},
                db=PostgresService(),
            ),
        )
    finally:
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            cursor.execute("DELETE FROM roles WHERE id = %s", (role_id,))
            cursor.execute("DELETE FROM departments WHERE id = %s", (department_id,))
            cursor.execute("DELETE FROM companies WHERE id = %s", (company_id,))
            if migration_applied:
                cursor.execute("DROP TRIGGER IF EXISTS users_admin_active_limit_guard ON users")
                cursor.execute("DROP TRIGGER IF EXISTS roles_admin_active_limit_guard ON roles")
                cursor.execute("DROP FUNCTION IF EXISTS enforce_admin_active_user_limit()")
                cursor.execute("DROP FUNCTION IF EXISTS enforce_admin_active_role_limit()")
                for table_name in MFA_TABLE_DROP_ORDER:
                    cursor.execute(sql.SQL("DROP TABLE {}").format(sql.Identifier(table_name)))
                cursor.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_mfa_check")
                for constraint_name, definition in prior_status_constraints:
                    cursor.execute(
                        sql.SQL("ALTER TABLE users ADD CONSTRAINT {} {}").format(
                            sql.Identifier(constraint_name), sql.SQL(definition)
                        )
                    )
                cursor.execute(
                    "DELETE FROM schema_migrations WHERE version = %s",
                    (MIGRATION.name,),
                )
        connection.commit()
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) AS count FROM users WHERE id = %s", (user_id,))
            assert cursor.fetchone()["count"] == 0
            cursor.execute(
                "SELECT count(*) AS count FROM schema_migrations WHERE version = %s",
                (MIGRATION.name,),
            )
            assert cursor.fetchone()["count"] == 0
        connection.close()


def test_email_otp_is_purpose_bound_attempt_limited_and_one_time(
    mfa_db: MfaDbFixture,
) -> None:
    issued = mfa_db.service.issue_email_otp(
        user_id=mfa_db.user_id,
        purpose="recovery",
        email=" Safe@Example.Test ",
        code="123456",
    )
    assert not mfa_db.service.consume_email_otp(
        issued.challengeId,
        user_id=mfa_db.user_id,
        purpose="login",
        email="safe@example.test",
        code="123456",
    )
    assert mfa_db.service.consume_email_otp(
        issued.challengeId,
        user_id=mfa_db.user_id,
        purpose="recovery",
        email="safe@example.test",
        code="123456",
    )
    assert not mfa_db.service.consume_email_otp(
        issued.challengeId,
        user_id=mfa_db.user_id,
        purpose="recovery",
        email="safe@example.test",
        code="123456",
    )

    limited = mfa_db.service.issue_email_otp(
        user_id=mfa_db.user_id,
        purpose="recovery",
        email="safe@example.test",
        code="654321",
    )
    for _ in range(5):
        assert not mfa_db.service.consume_email_otp(
            limited.challengeId,
            user_id=mfa_db.user_id,
            purpose="recovery",
            email="safe@example.test",
            code="000000",
        )
    assert not mfa_db.service.consume_email_otp(
        limited.challengeId,
        user_id=mfa_db.user_id,
        purpose="recovery",
        email="safe@example.test",
        code="654321",
    )


def test_email_otp_two_connection_race_has_one_winner(mfa_db: MfaDbFixture) -> None:
    issued = mfa_db.service.issue_email_otp(
        user_id=mfa_db.user_id,
        purpose="email_verify",
        email="safe@example.test",
        code="111222",
    )
    barrier = threading.Barrier(2)
    outcomes: list[bool] = []
    lock = threading.Lock()

    def consume() -> None:
        barrier.wait(timeout=5)
        result = mfa_db.service.consume_email_otp(
            issued.challengeId,
            user_id=mfa_db.user_id,
            purpose="email_verify",
            email="safe@example.test",
            code="111222",
        )
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=consume) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()
    assert sorted(outcomes) == [False, True]


def test_recovery_code_two_connection_race_has_one_winner(mfa_db: MfaDbFixture) -> None:
    code = mfa_db.service.issue_recovery_codes(
        profile_id=mfa_db.profile_id,
        user_id=mfa_db.user_id,
        count=1,
    )[0]
    barrier = threading.Barrier(2)
    outcomes: list[bool] = []
    lock = threading.Lock()

    def consume() -> None:
        barrier.wait(timeout=5)
        result = mfa_db.service.consume_recovery_code(
            profile_id=mfa_db.profile_id,
            user_id=mfa_db.user_id,
            code=code,
        )
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=consume) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()
    assert sorted(outcomes) == [False, True]


def test_totp_profile_two_connection_race_blocks_step_replay(mfa_db: MfaDbFixture) -> None:
    seed = b"12345678901234567890"
    encrypted = mfa_db.service.encrypt_totp_seed(mfa_db.profile_id, mfa_db.user_id, seed)
    connection = PostgresService().connect(_db_config())
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE admin_mfa_profiles
                SET recovery_email = %s,
                    recovery_email_verified_at = statement_timestamp(),
                    totp_key_version = %s,
                    totp_nonce = %s,
                    totp_ciphertext = %s,
                    totp_tag = %s,
                    status = 'active',
                    activated_at = statement_timestamp(),
                    updated_at = statement_timestamp()
                WHERE id = %s AND user_id = %s
                """,
                (
                    "safe@example.test",
                    encrypted.keyVersion,
                    encrypted.nonce,
                    encrypted.ciphertext,
                    encrypted.tag,
                    mfa_db.profile_id,
                    mfa_db.user_id,
                ),
            )
        connection.commit()
    finally:
        connection.close()

    at = datetime(2026, 8, 29, 12, 0, 0, tzinfo=UTC)
    code = mfa_db.service.totp_code(seed, at=at)
    barrier = threading.Barrier(2)
    outcomes: list[bool] = []
    lock = threading.Lock()

    def consume() -> None:
        barrier.wait(timeout=5)
        result = mfa_db.service.consume_profile_totp(
            profile_id=mfa_db.profile_id,
            user_id=mfa_db.user_id,
            code=code,
            at=at,
        )
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=consume) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()
    assert sorted(outcomes) == [False, True]
