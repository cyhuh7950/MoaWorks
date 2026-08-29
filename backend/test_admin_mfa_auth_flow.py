from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.dependencies import _validate_admin_mfa_claims
from app.core.config import settings
from app.schemas.admin_mfa import IssuedEmailOtp
from app.schemas.auth import (
    AdminMfaRecoveryRequest,
    AdminMfaRecoveryEmailRequest,
    AdminMfaRecoveryEmailVerifyRequest,
    AdminMfaRecoveryVerifyRequest,
    AdminMfaTotpConfirmRequest,
    AdminMfaTotpStartRequest,
    LoginRequest,
)
from app.schemas.directory import AuthUserSummary
from app.services.auth_service import AuthService
from app.services.admin_mfa_service import AdminMfaService
from app.services.directory_store import DirectoryStore
from app.services.postgres_service import PostgresService
from app.services.token_service import TokenService
from test_admin_mfa_service import MfaDbFixture, mfa_db


def _user(*, privileged: bool, status: str = "active") -> AuthUserSummary:
    return AuthUserSummary(
        userId="task9-user",
        companyId="task9-company",
        userName="Task 9",
        userEmail="task9@moaworks.invalid",
        roleId="task9-role",
        roleName="Task 9 role",
        userType="admin" if privileged else "user",
        status=status,
        permissions=["admin:*"] if privileged else ["profile:read"],
        authSessionVersion=7,
    )


def _store(user: AuthUserSummary) -> MagicMock:
    store = MagicMock()
    store.get_login_domain.return_value = "moaworks.invalid"
    store.authenticate.return_value = user
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.return_value = None
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store.db.connect.return_value = connection
    return store


def test_regular_user_password_login_keeps_authenticated_token_contract() -> None:
    user = _user(privileged=False)
    token_service = MagicMock(spec=TokenService)
    token_service.issue_access_token.return_value = "regular-token"

    response = AuthService(_store(user), token_service).login(
        LoginRequest(email=user.userEmail, password="fixture-password")
    )

    assert response.nextAction == "authenticated"
    assert response.accessToken == "regular-token"
    token_service.issue_access_token.assert_called_once_with(user, expires_in=3600)


def test_active_admin_password_login_returns_mfa_challenge_not_token() -> None:
    user = _user(privileged=True)
    token_service = MagicMock(spec=TokenService)
    challenge = SimpleNamespace(
        nextAction="mfa_required",
        challengeId="opaque-login-challenge",
        expiresAt=datetime.now(UTC) + timedelta(minutes=10),
    )

    with patch.object(
        AuthService,
        "_issue_admin_login_or_enrollment_challenge",
        return_value=challenge,
        create=True,
    ) as issue_challenge:
        response = AuthService(_store(user), token_service).login(
            LoginRequest(email=user.userEmail, password="fixture-password")
        )

    assert response.nextAction == "mfa_required"
    assert not hasattr(response, "accessToken")
    token_service.issue_access_token.assert_not_called()
    issue_challenge.assert_called_once_with(user)


def test_active_regular_user_with_pending_admin_invitation_gets_enrollment_challenge() -> None:
    user = _user(privileged=False)
    token_service = MagicMock(spec=TokenService)
    challenge = SimpleNamespace(
        nextAction="mfa_enrollment_required",
        challengeId="opaque-enrollment-challenge",
        expiresAt=datetime.now(UTC) + timedelta(minutes=10),
    )
    with (
        patch.object(AuthService, "_has_pending_admin_invitation", return_value=True, create=True),
        patch.object(
            AuthService,
            "_issue_admin_login_or_enrollment_challenge",
            return_value=challenge,
        ),
    ):
        response = AuthService(_store(user), token_service).login(
            LoginRequest(email=user.userEmail, password="fixture-password")
        )

    assert response.nextAction == "mfa_enrollment_required"
    token_service.issue_access_token.assert_not_called()


def test_pending_mfa_account_uses_limited_password_verification_path() -> None:
    user = _user(privileged=True, status="pending_mfa")
    store = _store(user)
    store.authenticate.side_effect = PermissionError("mail account inactive")
    token_service = MagicMock(spec=TokenService)
    challenge = SimpleNamespace(
        nextAction="mfa_enrollment_required",
        challengeId="opaque-pending-challenge",
        expiresAt=datetime.now(UTC) + timedelta(minutes=10),
    )
    with (
        patch.object(
            AuthService,
            "_authenticate_pending_admin",
            return_value=user,
            create=True,
        ) as authenticate_pending,
        patch.object(
            AuthService,
            "_issue_admin_login_or_enrollment_challenge",
            return_value=challenge,
        ),
    ):
        response = AuthService(store, token_service).login(
            LoginRequest(email=user.userEmail, password="fixture-password")
        )

    assert response.nextAction == "mfa_enrollment_required"
    authenticate_pending.assert_called_once()
    token_service.issue_access_token.assert_not_called()


def test_admin_mfa_token_contains_session_profile_policy_and_amr_claims() -> None:
    user = _user(privileged=True)
    verified_at = datetime.now(UTC)

    token = TokenService().issue_access_token(
        user,
        expires_in=3600,
        mfa_profile_version=4,
        mfa_policy_epoch=9,
        mfa_verified_at=verified_at,
    )
    payload = TokenService().decode_access_token(token)

    assert payload["sessionVersion"] == 7
    assert payload["amr"] == ["pwd", "otp"]
    assert payload["mfaProfileVersion"] == 4
    assert payload["mfaPolicyEpoch"] == 9
    assert payload["mfaVerifiedAt"] == verified_at.isoformat()
    assert isinstance(payload["iat"], str)


def test_required_admin_request_rejects_stale_policy_epoch() -> None:
    user = _user(privileged=True)
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.return_value = {
        "profile_version": 4,
        "profile_status": "active",
        "required_epoch": 10,
    }
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store = MagicMock()
    store.db.connect.return_value = connection
    payload = {
        "sessionVersion": 7,
        "amr": ["pwd", "otp"],
        "mfaProfileVersion": 4,
        "mfaPolicyEpoch": 9,
    }

    with patch.object(settings, "admin_mfa_enforcement", "required"):
        with pytest.raises(HTTPException) as caught:
            _validate_admin_mfa_claims(payload, user, store)

    assert caught.value.status_code == 401
    assert caught.value.detail["code"] == "AUTH_MFA_SESSION_STALE"


def test_totp_challenge_is_consumed_before_admin_token_is_issued() -> None:
    user = _user(privileged=True)
    moment = datetime.now(UTC).replace(microsecond=0)
    seed = b"task9-totp-seed-value"
    mfa_service = AdminMfaService(
        totp_current_key_version=1,
        totp_keys={1: b"t" * 32},
        otp_current_key_version=1,
        otp_hmac_keys={1: b"o" * 32},
        recovery_current_key_version=1,
        recovery_hmac_keys={1: b"r" * 32},
    )
    encrypted = mfa_service.encrypt_totp_seed("profile-1", user.userId, seed)
    code = mfa_service.totp_code(seed, at=moment)

    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        {
            "id": "challenge-row",
            "purpose": "login",
            "user_id": user.userId,
            "expires_at": moment + timedelta(minutes=5),
            "attempt_count": 0,
            "consumed_at": None,
            "cancelled_at": None,
            "db_now": moment,
        },
        {
            "id": "profile-1",
            "profile_version": 4,
            "totp_key_version": encrypted.keyVersion,
            "totp_nonce": encrypted.nonce,
            "totp_ciphertext": encrypted.ciphertext,
            "totp_tag": encrypted.tag,
            "last_used_step": None,
        },
        {"id": "profile-1"},
        {"id": "challenge-row"},
        {"required_epoch": 9},
    ]
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store = _store(user)
    store.db.connect.return_value = connection
    store.get_user_summary.return_value = user
    token_service = MagicMock(spec=TokenService)
    token_service.issue_access_token.return_value = "admin-mfa-token"
    service = AuthService(store, token_service, mfa_service=mfa_service)

    response = service.verify_admin_mfa(
        SimpleNamespace(challengeId="opaque-login-challenge", code=code)
    )

    assert response.accessToken == "admin-mfa-token"
    connection.commit.assert_called_once()
    token_service.issue_access_token.assert_called_once_with(
        user,
        expires_in=3600,
        mfa_profile_version=4,
        mfa_policy_epoch=9,
        mfa_verified_at=moment,
    )


def test_existing_postgresql_login_challenge_and_totp_are_one_time(
    mfa_db: MfaDbFixture,
) -> None:
    user = AuthUserSummary(
        userId=mfa_db.user_id,
        companyId="task9-company",
        userName="Task 9 DB",
        userEmail="task9-db@moaworks.invalid",
        roleId="task9-role",
        roleName="Task 9 role",
        userType="admin",
        status="active",
        permissions=["admin:*"],
        authSessionVersion=3,
    )
    seed = b"task9-existing-postgresql-seed"
    encrypted = mfa_db.service.encrypt_totp_seed(mfa_db.profile_id, mfa_db.user_id, seed)
    db = PostgresService()
    with db.connect() as connection, connection.cursor() as cursor:
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
                activated_at = statement_timestamp()
            WHERE id = %s
            """,
            (
                "task9-recovery@example.invalid",
                encrypted.keyVersion,
                encrypted.nonce,
                encrypted.ciphertext,
                encrypted.tag,
                mfa_db.profile_id,
            ),
        )
        connection.commit()

    store = MagicMock()
    store.db = db
    store.get_user_summary.return_value = user
    service = AuthService(store, TokenService(), mfa_service=mfa_db.service)
    try:
        challenge = service._issue_admin_login_or_enrollment_challenge(user)
        assert challenge.nextAction == "mfa_required"
        code = mfa_db.service.totp_code(seed)
        response = service.verify_admin_mfa(
            SimpleNamespace(challengeId=challenge.challengeId, code=code)
        )
        assert response.nextAction == "authenticated"
        decoded = TokenService().decode_access_token(response.accessToken)
        assert decoded["amr"] == ["pwd", "otp"]
        assert decoded["sessionVersion"] == 3

        with pytest.raises(HTTPException) as replay:
            service.verify_admin_mfa(
                SimpleNamespace(challengeId=challenge.challengeId, code=code)
            )
        assert replay.value.detail["code"] == "AUTH_MFA_CHALLENGE_INVALID"
    finally:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM admin_mfa_challenges WHERE user_id = %s",
                (mfa_db.user_id,),
            )
            cursor.execute(
                """
                UPDATE admin_mfa_profiles
                SET recovery_email = NULL,
                    recovery_email_verified_at = NULL,
                    totp_key_version = NULL,
                    totp_nonce = NULL,
                    totp_ciphertext = NULL,
                    totp_tag = NULL,
                    last_used_step = NULL,
                    status = 'pending',
                    activated_at = NULL
                WHERE id = %s
                """,
                (mfa_db.profile_id,),
            )
            connection.commit()


def test_recovery_verification_returns_reenroll_challenge_not_admin_token() -> None:
    moment = datetime.now(UTC).replace(microsecond=0)
    user = _user(privileged=True)
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        {
            "id": "email-challenge-row",
            "user_id": user.userId,
            "target_email": "masked-recovery@example.invalid",
            "expires_at": moment + timedelta(minutes=5),
            "consumed_at": None,
            "cancelled_at": None,
            "db_now": moment,
        },
        {"expires_at": moment + timedelta(minutes=10)},
    ]
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store = _store(user)
    store.db.connect.return_value = connection
    mfa_service = MagicMock(spec=AdminMfaService)
    mfa_service.consume_email_otp.return_value = True
    token_service = MagicMock(spec=TokenService)

    response = AuthService(
        store,
        token_service,
        mfa_service=mfa_service,
    ).verify_recovery(
        AdminMfaRecoveryVerifyRequest(
            challengeId="opaque-recovery-challenge",
            code="123456",
        )
    )

    assert response.nextAction == "mfa_reenroll_required"
    assert response.challengeId
    assert not hasattr(response, "accessToken")
    token_service.issue_access_token.assert_not_called()
    connection.commit.assert_called_once()


def test_recovery_code_request_contract_accepts_high_entropy_code_without_email_otp() -> None:
    payload = AdminMfaRecoveryVerifyRequest(
        email="task9@moaworks.invalid",
        recoveryCode="recovery-code-with-more-than-128-bits-of-entropy",
    )

    assert payload.code is None
    assert payload.recoveryCode.startswith("recovery-code-")


def test_existing_postgresql_recovery_code_is_one_time_and_only_issues_reenroll(
    mfa_db: MfaDbFixture,
) -> None:
    db = PostgresService()
    recovery_email = "task9-code-recovery@example.invalid"
    encrypted = mfa_db.service.encrypt_totp_seed(
        mfa_db.profile_id,
        mfa_db.user_id,
        b"task9-recovery-code-postgresql-seed",
    )
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT email FROM users WHERE id = %s", (mfa_db.user_id,))
        login_email = cursor.fetchone()["email"]
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
                activated_at = statement_timestamp()
            WHERE id = %s
            """,
            (
                recovery_email,
                encrypted.keyVersion,
                encrypted.nonce,
                encrypted.ciphertext,
                encrypted.tag,
                mfa_db.profile_id,
            ),
        )
        connection.commit()

    codes = mfa_db.service.issue_recovery_codes(
        profile_id=mfa_db.profile_id,
        user_id=mfa_db.user_id,
        count=1,
    )
    store = DirectoryStore()
    store.db = db
    token_service = MagicMock(spec=TokenService)
    service = AuthService(store, token_service, mfa_service=mfa_db.service)
    try:
        response = service.verify_recovery(
            AdminMfaRecoveryVerifyRequest(
                email=login_email,
                recoveryCode=codes[0],
            )
        )
        assert response.nextAction == "mfa_reenroll_required"
        assert response.challengeId
        assert not hasattr(response, "accessToken")
        token_service.issue_access_token.assert_not_called()
        started = service.start_totp_enrollment(
            None,
            AdminMfaTotpStartRequest(flowChallengeId=response.challengeId),
        )
        assert started.challengeId
        assert started.manualKey

        with pytest.raises(HTTPException) as replay:
            service.verify_recovery(
                AdminMfaRecoveryVerifyRequest(
                    email=login_email,
                    recoveryCode=codes[0],
                )
            )
        assert replay.value.detail["code"] == "AUTH_MFA_RECOVERY_INVALID"
    finally:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM admin_mfa_recovery_codes WHERE profile_id = %s",
                (mfa_db.profile_id,),
            )
            cursor.execute(
                "DELETE FROM admin_mfa_challenges WHERE user_id = %s",
                (mfa_db.user_id,),
            )
            cursor.execute(
                """
                UPDATE admin_mfa_profiles
                SET recovery_email = NULL,
                    recovery_email_verified_at = NULL,
                    totp_key_version = NULL,
                    totp_nonce = NULL,
                    totp_ciphertext = NULL,
                    totp_tag = NULL,
                    last_used_step = NULL,
                    status = 'pending',
                    activated_at = NULL
                WHERE id = %s
                """,
                (mfa_db.profile_id,),
            )
            connection.commit()


def test_existing_postgresql_active_admin_recovery_email_change_is_atomic(
    mfa_db: MfaDbFixture,
) -> None:
    db = PostgresService()
    previous_email = "task9-old-recovery@example.invalid"
    replacement_email = "task9-new-recovery@example.invalid"
    encrypted = mfa_db.service.encrypt_totp_seed(
        mfa_db.profile_id,
        mfa_db.user_id,
        b"task9-recovery-email-change-seed",
    )
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT company_id, email, name, role_id, status, user_type, auth_session_version "
            "FROM users WHERE id = %s",
            (mfa_db.user_id,),
        )
        user_row = cursor.fetchone()
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
                activated_at = statement_timestamp()
            WHERE id = %s
            """,
            (
                previous_email,
                encrypted.keyVersion,
                encrypted.nonce,
                encrypted.ciphertext,
                encrypted.tag,
                mfa_db.profile_id,
            ),
        )
        connection.commit()

    issued = mfa_db.service.issue_email_otp(
        user_id=mfa_db.user_id,
        purpose="email_verify",
        email=replacement_email,
        code="381924",
    )
    actor = AuthUserSummary(
        userId=mfa_db.user_id,
        companyId=user_row["company_id"],
        userName=user_row["name"],
        userEmail=user_row["email"],
        roleId=user_row["role_id"],
        roleName="Task 8 fixture",
        userType=user_row["user_type"],
        status=user_row["status"],
        permissions=["admin:*"],
        authSessionVersion=user_row["auth_session_version"],
    )
    store = DirectoryStore()
    store.db = db
    service = AuthService(store, TokenService(), mfa_service=mfa_db.service)
    try:
        verified = service.verify_recovery_email(
            actor,
            AdminMfaRecoveryEmailVerifyRequest(
                verificationChallengeId=issued.challengeId,
                recoveryEmail=replacement_email,
                code=issued.code,
            ),
        )
        assert verified.verified is True
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT recovery_email, profile_version FROM admin_mfa_profiles WHERE id = %s",
                (mfa_db.profile_id,),
            )
            profile = cursor.fetchone()
            cursor.execute(
                "SELECT auth_session_version FROM users WHERE id = %s",
                (mfa_db.user_id,),
            )
            session_version = cursor.fetchone()["auth_session_version"]
        assert profile["recovery_email"] == replacement_email
        assert profile["profile_version"] == 1
        assert session_version == user_row["auth_session_version"] + 1
    finally:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM admin_mfa_challenges WHERE user_id = %s",
                (mfa_db.user_id,),
            )
            cursor.execute(
                """
                UPDATE admin_mfa_profiles
                SET recovery_email = NULL, recovery_email_verified_at = NULL,
                    totp_key_version = NULL, totp_nonce = NULL,
                    totp_ciphertext = NULL, totp_tag = NULL,
                    profile_version = 0, last_used_step = NULL,
                    status = 'pending', activated_at = NULL
                WHERE id = %s
                """,
                (mfa_db.profile_id,),
            )
            cursor.execute(
                "UPDATE users SET auth_session_version = %s WHERE id = %s",
                (user_row["auth_session_version"], mfa_db.user_id),
            )
            connection.commit()


def test_recovery_request_sends_otp_without_returning_plaintext_code() -> None:
    moment = datetime.now(UTC).replace(microsecond=0)
    user = _user(privileged=True)
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.return_value = {
        "user_id": user.userId,
        "recovery_email": "recovery@example.invalid",
    }
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store = _store(user)
    store.db.connect.return_value = connection
    mfa_service = MagicMock(spec=AdminMfaService)
    mfa_service.issue_email_otp.return_value = IssuedEmailOtp(
        challengeId="opaque-recovery-challenge",
        code="654321",
        expiresAt=moment + timedelta(minutes=10),
    )
    sender = MagicMock()

    response = AuthService(
        store,
        MagicMock(spec=TokenService),
        mfa_service=mfa_service,
        recovery_email_sender=sender,
    ).request_recovery(AdminMfaRecoveryRequest(email=user.userEmail))

    assert response.challengeId == "opaque-recovery-challenge"
    assert not hasattr(response, "code")
    sender.assert_called_once_with("recovery@example.invalid", "654321")


def test_existing_postgresql_pending_invitation_enrolls_atomically(
    mfa_db: MfaDbFixture,
) -> None:
    db = PostgresService()
    prefix = f"{mfa_db.prefix}_task9_enroll"
    admin_role_id = f"{prefix}_role"
    invitation_id = f"{prefix}_invitation"
    provider_id = f"{prefix}_provider"
    mail_account_id = f"{prefix}_mail"
    user_email = f"{mfa_db.user_id}@{mfa_db.prefix}.invalid"
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT role_id, user_type, status, auth_session_version FROM users WHERE id = %s",
            (mfa_db.user_id,),
        )
        original_user = cursor.fetchone()
        cursor.execute(
            "SELECT company_id FROM users WHERE id = %s",
            (mfa_db.user_id,),
        )
        company_id = cursor.fetchone()["company_id"]
        cursor.execute(
            """
            INSERT INTO roles (id, company_id, name, permissions, status, created_at)
            VALUES (%s, %s, %s, '["admin:*"]'::jsonb, 'active', statement_timestamp())
            """,
            (admin_role_id, company_id, "Task 9 enrollment role"),
        )
        cursor.execute(
            """
            INSERT INTO mail_provider_configs (
                id, company_id, provider_type, relay_host, relay_port, username,
                encrypted_password, active, last_test_status,
                last_test_message, updated_at
            ) VALUES (
                %s, %s, 'smtp', '127.0.0.1', 2525, '', '', TRUE,
                'not_tested', 'Task 9 fixture', statement_timestamp()
            )
            """,
            (provider_id, company_id),
        )
        cursor.execute(
            """
            INSERT INTO mail_accounts (
                id, user_id, email, quota_mb, status, provider_config_id,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, 1024, 'active', %s,
                statement_timestamp(), statement_timestamp()
            )
            """,
            (mail_account_id, mfa_db.user_id, user_email, provider_id),
        )
        cursor.execute(
            """
            INSERT INTO admin_mfa_invitations (
                id, target_user_id, invitation_kind, requested_user_type,
                requested_role_id, requested_status, status, expires_at
            ) VALUES (
                %s, %s, 'promotion', 'admin', %s, 'active', 'pending',
                statement_timestamp() + interval '30 minutes'
            )
            """,
            (invitation_id, mfa_db.user_id, admin_role_id),
        )
        connection.commit()

    user = AuthUserSummary(
        userId=mfa_db.user_id,
        companyId=company_id,
        userName="Task 9 enrollment",
        userEmail=user_email,
        roleId=original_user["role_id"],
        roleName="Task 8 fixture",
        userType="user",
        status="active",
        permissions=[],
        authSessionVersion=original_user["auth_session_version"],
    )
    store = DirectoryStore()
    store.db = db
    sent: list[tuple[str, str]] = []
    token_service = TokenService()
    service = AuthService(
        store,
        token_service,
        mfa_service=mfa_db.service,
        recovery_email_sender=lambda email, code: sent.append((email, code)),
    )
    try:
        flow = service._issue_admin_login_or_enrollment_challenge(user)
        requested = service.request_recovery_email(
            None,
            AdminMfaRecoveryEmailRequest(
                flowChallengeId=flow.challengeId,
                recoveryEmail="task9-recovery@example.invalid",
            ),
        )
        assert sent and sent[0][0] == "task9-recovery@example.invalid"
        verified = service.verify_recovery_email(
            None,
            AdminMfaRecoveryEmailVerifyRequest(
                flowChallengeId=flow.challengeId,
                verificationChallengeId=requested.challengeId,
                recoveryEmail="task9-recovery@example.invalid",
                code=sent[0][1],
            ),
        )
        assert verified.verified is True

        started = service.start_totp_enrollment(
            None,
            AdminMfaTotpStartRequest(
                flowChallengeId=flow.challengeId,
                verificationChallengeId=requested.challengeId,
            ),
        )
        padded = started.manualKey + "=" * ((8 - len(started.manualKey) % 8) % 8)
        seed = base64.b32decode(padded)
        completed = service.confirm_totp_enrollment(
            AdminMfaTotpConfirmRequest(
                challengeId=started.challengeId,
                code=mfa_db.service.totp_code(seed),
            )
        )
        assert completed.nextAction == "authenticated"
        assert len(completed.recoveryCodes) == 10
        decoded = token_service.decode_access_token(completed.accessToken)
        assert decoded["amr"] == ["pwd", "otp"]

        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT user_type, role_id, status FROM users WHERE id = %s",
                (mfa_db.user_id,),
            )
            promoted = cursor.fetchone()
            assert promoted == {
                "user_type": "admin",
                "role_id": admin_role_id,
                "status": "active",
            }
            cursor.execute(
                "SELECT status, recovery_email FROM admin_mfa_profiles WHERE id = %s",
                (mfa_db.profile_id,),
            )
            profile = cursor.fetchone()
            assert profile["status"] == "active"
            assert profile["recovery_email"] == "task9-recovery@example.invalid"
    finally:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM admin_mfa_recovery_codes WHERE profile_id = %s",
                (mfa_db.profile_id,),
            )
            cursor.execute(
                "DELETE FROM admin_mfa_challenges WHERE user_id = %s",
                (mfa_db.user_id,),
            )
            cursor.execute(
                "DELETE FROM admin_mfa_invitations WHERE id = %s",
                (invitation_id,),
            )
            cursor.execute(
                """
                UPDATE admin_mfa_profiles
                SET recovery_email = NULL, recovery_email_verified_at = NULL,
                    totp_key_version = NULL, totp_nonce = NULL,
                    totp_ciphertext = NULL, totp_tag = NULL,
                    profile_version = 0, last_used_step = NULL,
                    status = 'pending', activated_at = NULL
                WHERE id = %s
                """,
                (mfa_db.profile_id,),
            )
            cursor.execute(
                """
                UPDATE users
                SET role_id = %s, user_type = %s, status = %s,
                    auth_session_version = %s
                WHERE id = %s
                """,
                (
                    original_user["role_id"],
                    original_user["user_type"],
                    original_user["status"],
                    original_user["auth_session_version"],
                    mfa_db.user_id,
                ),
            )
            cursor.execute("DELETE FROM mail_accounts WHERE id = %s", (mail_account_id,))
            cursor.execute("DELETE FROM mail_provider_configs WHERE id = %s", (provider_id,))
            cursor.execute("DELETE FROM roles WHERE id = %s", (admin_role_id,))
            connection.commit()


def test_existing_postgresql_fourth_admin_enrollment_rolls_back_every_change(
    mfa_db: MfaDbFixture,
) -> None:
    db = PostgresService()
    prefix = f"{mfa_db.prefix}_task9_limit"
    admin_role_id = f"{prefix}_role"
    provider_id = f"{prefix}_provider"
    mail_account_id = f"{prefix}_mail"
    invitation_id = f"{prefix}_invitation"
    admin_ids: list[str] = []
    challenge_id = f"{prefix}_enrollment_challenge"
    challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
    seed = b"task9-fourth-admin-rollback-seed"
    encrypted = mfa_db.service.encrypt_totp_seed(mfa_db.profile_id, mfa_db.user_id, seed)

    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT company_id, department_id, role_id, status, user_type, auth_session_version "
            "FROM users WHERE id = %s",
            (mfa_db.user_id,),
        )
        original_user = cursor.fetchone()
        cursor.execute(
            """
            SELECT count(*) AS count
            FROM users AS active_user
            LEFT JOIN roles AS active_role ON active_role.id = active_user.role_id
            WHERE active_user.status = 'active'
              AND (
                  active_user.user_type = 'admin'
                  OR active_role.permissions ? 'admin:*'
              )
            """
        )
        slots_to_fill = max(0, 3 - int(cursor.fetchone()["count"]))
        admin_ids = [f"{prefix}_admin_{index}" for index in range(slots_to_fill)]
        cursor.execute(
            """
            INSERT INTO roles (id, company_id, name, permissions, status, created_at)
            VALUES (%s, %s, %s, '["admin:*"]'::jsonb, 'active', statement_timestamp())
            """,
            (admin_role_id, original_user["company_id"], "Task 9 limit role"),
        )
        for index, admin_id in enumerate(admin_ids):
            cursor.execute(
                """
                INSERT INTO users (
                    id, company_id, email, name, password_hash, department_id, role_id,
                    status, user_type, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, 'fixture-hash', %s, %s,
                    'active', 'admin', statement_timestamp(), statement_timestamp()
                )
                """,
                (
                    admin_id,
                    original_user["company_id"],
                    f"{admin_id}@example.invalid",
                    f"Task 9 admin {index}",
                    original_user["department_id"],
                    admin_role_id,
                ),
            )
        cursor.execute(
            "UPDATE users SET status = 'pending_mfa' WHERE id = %s",
            (mfa_db.user_id,),
        )
        cursor.execute(
            """
            INSERT INTO mail_provider_configs (
                id, company_id, provider_type, relay_host, relay_port, username,
                encrypted_password, active, last_test_status, last_test_message, updated_at
            ) VALUES (
                %s, %s, 'smtp', '127.0.0.1', 2525, '', '', TRUE,
                'not_tested', 'Task 9 rollback fixture', statement_timestamp()
            )
            """,
            (provider_id, original_user["company_id"]),
        )
        cursor.execute(
            """
            INSERT INTO mail_accounts (
                id, user_id, email, quota_mb, status, provider_config_id,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, 4096, 'inactive', %s,
                statement_timestamp(), statement_timestamp()
            )
            """,
            (
                mail_account_id,
                mfa_db.user_id,
                f"{mfa_db.user_id}@example.invalid",
                provider_id,
            ),
        )
        cursor.execute(
            """
            INSERT INTO admin_mfa_invitations (
                id, target_user_id, invitation_kind, requested_user_type,
                requested_role_id, requested_status, status, expires_at
            ) VALUES (
                %s, %s, 'promotion', 'admin', %s, 'active', 'pending',
                statement_timestamp() + interval '30 minutes'
            )
            """,
            (invitation_id, mfa_db.user_id, admin_role_id),
        )
        cursor.execute(
            """
            INSERT INTO admin_mfa_challenges (
                id, challenge_hash, purpose, user_id, target_email,
                pending_totp_key_version, pending_totp_nonce,
                pending_totp_ciphertext, pending_totp_tag, expires_at
            ) VALUES (
                %s, %s, 'enroll', %s, %s, %s, %s, %s, %s,
                statement_timestamp() + interval '10 minutes'
            )
            """,
            (
                uuid4().hex,
                challenge_hash,
                mfa_db.user_id,
                "task9-limit-recovery@example.invalid",
                encrypted.keyVersion,
                encrypted.nonce,
                encrypted.ciphertext,
                encrypted.tag,
            ),
        )
        connection.commit()

    store = DirectoryStore()
    store.db = db
    token_service = MagicMock(spec=TokenService)
    service = AuthService(store, token_service, mfa_service=mfa_db.service)
    try:
        with pytest.raises(HTTPException) as blocked:
            service.confirm_totp_enrollment(
                AdminMfaTotpConfirmRequest(
                    challengeId=challenge_id,
                    code=mfa_db.service.totp_code(seed),
                )
            )
        assert blocked.value.status_code == 409
        assert blocked.value.detail["code"] == "ADMIN_ACTIVE_LIMIT_REACHED"
        token_service.issue_access_token.assert_not_called()

        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT role_id, status, user_type FROM users WHERE id = %s",
                (mfa_db.user_id,),
            )
            target = cursor.fetchone()
            cursor.execute(
                "SELECT status, recovery_email FROM admin_mfa_profiles WHERE id = %s",
                (mfa_db.profile_id,),
            )
            profile = cursor.fetchone()
            cursor.execute(
                "SELECT status FROM admin_mfa_invitations WHERE id = %s",
                (invitation_id,),
            )
            invitation = cursor.fetchone()
            cursor.execute(
                "SELECT status FROM mail_accounts WHERE id = %s",
                (mail_account_id,),
            )
            mail_account = cursor.fetchone()
            cursor.execute(
                "SELECT count(*) AS count FROM admin_mfa_recovery_codes WHERE profile_id = %s",
                (mfa_db.profile_id,),
            )
            recovery_count = cursor.fetchone()["count"]
        assert target == {
            "role_id": original_user["role_id"],
            "status": "pending_mfa",
            "user_type": original_user["user_type"],
        }
        assert profile == {"status": "pending", "recovery_email": None}
        assert invitation["status"] == "pending"
        assert mail_account["status"] == "inactive"
        assert recovery_count == 0
    finally:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM admin_mfa_recovery_codes WHERE profile_id = %s",
                (mfa_db.profile_id,),
            )
            cursor.execute(
                "DELETE FROM admin_mfa_challenges WHERE user_id = %s",
                (mfa_db.user_id,),
            )
            cursor.execute(
                "DELETE FROM admin_mfa_invitations WHERE id = %s",
                (invitation_id,),
            )
            cursor.execute("DELETE FROM mail_accounts WHERE id = %s", (mail_account_id,))
            cursor.execute("DELETE FROM mail_provider_configs WHERE id = %s", (provider_id,))
            cursor.execute(
                """
                UPDATE admin_mfa_profiles
                SET recovery_email = NULL, recovery_email_verified_at = NULL,
                    totp_key_version = NULL, totp_nonce = NULL,
                    totp_ciphertext = NULL, totp_tag = NULL,
                    profile_version = 0, last_used_step = NULL,
                    status = 'pending', activated_at = NULL
                WHERE id = %s
                """,
                (mfa_db.profile_id,),
            )
            cursor.execute(
                """
                UPDATE users
                SET role_id = %s, status = %s, user_type = %s,
                    auth_session_version = %s
                WHERE id = %s
                """,
                (
                    original_user["role_id"],
                    original_user["status"],
                    original_user["user_type"],
                    original_user["auth_session_version"],
                    mfa_db.user_id,
                ),
            )
            cursor.execute("DELETE FROM users WHERE id = ANY(%s)", (admin_ids,))
            cursor.execute("DELETE FROM roles WHERE id = %s", (admin_role_id,))
            connection.commit()
