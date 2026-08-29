from __future__ import annotations

import base64
from datetime import datetime, timedelta
import hashlib
import secrets
from typing import Callable
from uuid import uuid4

from fastapi import HTTPException, status
from psycopg.errors import CheckViolation

from app.schemas.admin_mfa import AdminMfaQrPng, EncryptedMfaSecret
from app.schemas.auth import (
    AdminMfaEnrollmentCompleted,
    AdminMfaRecoveryEmailRequest,
    AdminMfaRecoveryEmailRequested,
    AdminMfaRecoveryEmailVerified,
    AdminMfaRecoveryEmailVerifyRequest,
    AdminMfaRecoveryVerifyRequest,
    AdminMfaRecoveryRequest,
    AdminMfaRecoveryRequested,
    AdminMfaReenrollRequired,
    AdminMfaRequired,
    AdminMfaTotpConfirmRequest,
    AdminMfaTotpQrRequest,
    AdminMfaTotpStartRequest,
    AdminMfaTotpStartResponse,
    AdminMfaStatusResponse,
    AdminMfaVerifyRequest,
    AuthLoginResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    PasswordChangeResponse,
)
from app.schemas.directory import AuthUserSummary
from app.services.admin_mfa_service import AdminMfaService
from app.services.directory_store import DirectoryStore
from app.services.token_service import TokenService


class AuthService:
    def __init__(
        self,
        store: DirectoryStore,
        token_service: TokenService,
        *,
        mfa_service: AdminMfaService | None = None,
        recovery_email_sender: Callable[[str, str], None] | None = None,
    ) -> None:
        self.store = store
        self.token_service = token_service
        self._admin_mfa_service = mfa_service
        self._recovery_email_sender = recovery_email_sender

    def _mfa_service(self) -> AdminMfaService:
        if self._admin_mfa_service is not None:
            return self._admin_mfa_service
        service = AdminMfaService.from_settings(endpoint_used=True)
        if service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "ADMIN_MFA_UNAVAILABLE",
                    "userMessage": "관리자 인증 설정을 확인해 주세요.",
                    "adminMessage": "관리자 MFA service 설정이 없습니다.",
                },
            )
        if service._db is None:
            service._db = self.store.db
        return service

    def request_recovery(
        self,
        payload: AdminMfaRecoveryRequest,
    ) -> AdminMfaRecoveryRequested:
        mfa_service = self._mfa_service()
        self.store.db.ensure_migrations_applied()
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT users.id AS user_id, profile.recovery_email
                    FROM users
                    JOIN admin_mfa_profiles AS profile ON profile.user_id = users.id
                    WHERE LOWER(users.email) = %s
                      AND users.status = 'active'
                      AND profile.status = 'active'
                      AND profile.recovery_email_verified_at IS NOT NULL
                    """,
                    (payload.email,),
                )
                account = cursor.fetchone()

        if account is None:
            return AdminMfaRecoveryRequested(
                challengeId=secrets.token_urlsafe(24),
                expiresAt=datetime.now().astimezone() + timedelta(minutes=10),
            )

        issued = mfa_service.issue_email_otp(
            user_id=account["user_id"],
            purpose="recovery",
            email=account["recovery_email"],
        )
        try:
            sender = self._recovery_email_sender or self._send_recovery_email
            sender(account["recovery_email"], issued.code)
        except Exception:
            self._cancel_challenge(issued.challengeId)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "AUTH_MFA_RECOVERY_DELIVERY_FAILED",
                    "userMessage": "복구 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.",
                },
            )
        return AdminMfaRecoveryRequested(
            challengeId=issued.challengeId,
            expiresAt=issued.expiresAt,
        )

    def _send_recovery_email(self, recipient: str, code: str) -> None:
        from app.schemas.mail_messenger import MailSendRequest
        from app.services.mail_messenger_service import MailMessengerService

        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT users.id
                    FROM users
                    JOIN mail_accounts ON mail_accounts.user_id = users.id
                    LEFT JOIN roles ON roles.id = users.role_id
                    WHERE users.status = 'active'
                      AND mail_accounts.status = 'active'
                    ORDER BY
                      CASE WHEN users.user_type = 'admin'
                                OR COALESCE(roles.permissions, '[]'::jsonb) ? 'admin:*'
                           THEN 0 ELSE 1 END,
                      users.created_at,
                      users.id
                    LIMIT 1
                    """
                )
                sender_row = cursor.fetchone()
        if sender_row is None:
            raise RuntimeError("복구 메일 발신 계정을 찾을 수 없습니다.")
        actor = self.store.get_user_summary(sender_row["id"])
        mailer = MailMessengerService()
        mailer.db = self.store.db
        mailer.send_mail(
            actor,
            MailSendRequest(
                to=[recipient],
                subject="MoaWorks 관리자 인증 코드",
                bodyText=f"관리자 인증 코드는 {code}입니다. 10분 안에 입력하세요.",
                confirmed=True,
            ),
        )

    def _cancel_challenge(self, challenge_id: str) -> None:
        challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE admin_mfa_challenges
                    SET cancelled_at = statement_timestamp()
                    WHERE challenge_hash = %s
                      AND consumed_at IS NULL
                      AND cancelled_at IS NULL
                    """,
                    (challenge_hash,),
                )
            connection.commit()

    def _resolve_mfa_flow_user(
        self,
        actor: AuthUserSummary | None,
        flow_challenge_id: str | None,
    ) -> AuthUserSummary:
        if flow_challenge_id is None:
            if actor is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"code": "AUTH_MFA_FLOW_REQUIRED", "userMessage": "관리자 인증 요청이 필요합니다."},
                )
            return actor

        challenge_hash = hashlib.sha256(flow_challenge_id.encode("utf-8")).digest()
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id, purpose, expires_at, consumed_at, cancelled_at,
                           statement_timestamp() AS db_now
                    FROM admin_mfa_challenges
                    WHERE challenge_hash = %s
                    """,
                    (challenge_hash,),
                )
                flow = cursor.fetchone()
                valid = (
                    flow is not None
                    and flow["purpose"] in {"admin_enrollment", "mfa_reenroll"}
                    and flow["consumed_at"] is None
                    and flow["cancelled_at"] is None
                    and flow["expires_at"] > flow["db_now"]
                    and (actor is None or actor.userId == flow["user_id"])
                )
                if not valid:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail={"code": "AUTH_MFA_FLOW_INVALID", "userMessage": "관리자 인증 요청이 만료되었거나 올바르지 않습니다."},
                    )
                cursor.execute(
                    """
                    SELECT u.id AS user_id, u.company_id, u.name AS user_name,
                           u.email AS user_email, u.password_hash, u.department_id,
                           u.role_id, u.status AS user_status, u.user_type,
                           u.is_department_head, u.must_change_password,
                           u.auth_session_version, d.name AS department_name,
                           r.name AS role_name, r.permissions, r.status AS role_status,
                           ma.email AS mail_account_email,
                           ma.status AS mail_account_status
                    FROM users AS u
                    JOIN departments AS d ON d.id = u.department_id
                    JOIN roles AS r ON r.id = u.role_id
                    LEFT JOIN mail_accounts AS ma ON ma.user_id = u.id
                    WHERE u.id = %s
                    """,
                    (flow["user_id"],),
                )
                row = cursor.fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "AUTH_MFA_FLOW_INVALID", "userMessage": "관리자 인증 대상 계정을 찾을 수 없습니다."},
            )
        return self.store._row_to_auth_summary(row)

    def request_recovery_email(
        self,
        actor: AuthUserSummary | None,
        payload: AdminMfaRecoveryEmailRequest,
    ) -> AdminMfaRecoveryEmailRequested:
        user = self._resolve_mfa_flow_user(actor, payload.flowChallengeId)
        mfa_service = self._mfa_service()
        if payload.flowChallengeId is None:
            with self.store.db.connect() as connection:
                with connection.cursor() as cursor:
                    row = self.store._fetch_user_access_row(cursor, "u.id = %s", (user.userId,))
                    cursor.execute(
                        "SELECT id, status FROM admin_mfa_profiles WHERE user_id = %s",
                        (user.userId,),
                    )
                    profile = cursor.fetchone()
            if row is None or not payload.currentPassword or not self.store.security.verify_password(
                payload.currentPassword, row["password_hash"]
            ):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"code": "AUTH_MFA_STEP_UP_FAILED", "userMessage": "현재 비밀번호가 올바르지 않습니다."},
                )
            if profile is not None and profile["status"] == "active":
                if not payload.currentTotp or not mfa_service.consume_profile_totp(
                    profile_id=profile["id"], user_id=user.userId, code=payload.currentTotp
                ):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail={"code": "AUTH_MFA_STEP_UP_FAILED", "userMessage": "현재 인증 앱 코드가 올바르지 않습니다."},
                    )

        issued = mfa_service.issue_email_otp(
            user_id=user.userId,
            purpose="email_verify",
            email=payload.recoveryEmail,
        )
        try:
            sender = self._recovery_email_sender or self._send_recovery_email
            sender(payload.recoveryEmail, issued.code)
        except Exception:
            self._cancel_challenge(issued.challengeId)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "AUTH_MFA_EMAIL_DELIVERY_FAILED", "userMessage": "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요."},
            )
        return AdminMfaRecoveryEmailRequested(
            challengeId=issued.challengeId,
            expiresAt=issued.expiresAt,
        )

    def verify_recovery_email(
        self,
        actor: AuthUserSummary | None,
        payload: AdminMfaRecoveryEmailVerifyRequest,
    ) -> AdminMfaRecoveryEmailVerified:
        user = self._resolve_mfa_flow_user(actor, payload.flowChallengeId)
        if not self._mfa_service().consume_email_otp(
            payload.verificationChallengeId,
            user_id=user.userId,
            purpose="email_verify",
            email=payload.recoveryEmail,
            code=payload.code,
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "AUTH_MFA_EMAIL_CODE_INVALID", "userMessage": "이메일 인증 코드가 올바르지 않습니다."},
            )
        if payload.flowChallengeId is None:
            with self.store.db.connect() as connection, connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE admin_mfa_profiles
                    SET recovery_email = %s,
                        recovery_email_verified_at = statement_timestamp(),
                        profile_version = profile_version + 1,
                        updated_at = statement_timestamp()
                    WHERE user_id = %s AND status = 'active'
                    RETURNING id
                    """,
                    (payload.recoveryEmail, user.userId),
                )
                if cursor.fetchone() is None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "code": "AUTH_MFA_PROFILE_NOT_ACTIVE",
                            "userMessage": "활성 관리자 인증 프로필을 찾을 수 없습니다.",
                        },
                    )
                cursor.execute(
                    """
                    UPDATE users
                    SET auth_session_version = auth_session_version + 1,
                        updated_at = statement_timestamp()
                    WHERE id = %s
                    """,
                    (user.userId,),
                )
                connection.commit()
        return AdminMfaRecoveryEmailVerified()

    def start_totp_enrollment(
        self,
        actor: AuthUserSummary | None,
        payload: AdminMfaTotpStartRequest,
    ) -> AdminMfaTotpStartResponse:
        user = self._resolve_mfa_flow_user(actor, payload.flowChallengeId)
        challenge_id = secrets.token_urlsafe(24)
        challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
        seed = secrets.token_bytes(20)
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                verified = None
                if payload.verificationChallengeId is not None:
                    verification_hash = hashlib.sha256(
                        payload.verificationChallengeId.encode("utf-8")
                    ).digest()
                    cursor.execute(
                        """
                        SELECT target_email, consumed_at, cancelled_at, expires_at,
                               statement_timestamp() AS db_now
                        FROM admin_mfa_challenges
                        WHERE challenge_hash = %s AND purpose = 'email_verify' AND user_id = %s
                        """,
                        (verification_hash, user.userId),
                    )
                    verified = cursor.fetchone()
                if verified is None and payload.flowChallengeId is not None:
                    flow_hash = hashlib.sha256(payload.flowChallengeId.encode("utf-8")).digest()
                    cursor.execute(
                        """
                        SELECT id, target_email, consumed_at, cancelled_at, expires_at,
                               statement_timestamp() AS db_now
                        FROM admin_mfa_challenges
                        WHERE challenge_hash = %s AND purpose = 'mfa_reenroll' AND user_id = %s
                        FOR UPDATE
                        """,
                        (flow_hash, user.userId),
                    )
                    verified = cursor.fetchone()
                    if verified is not None:
                        cursor.execute(
                            """
                            UPDATE admin_mfa_challenges
                            SET consumed_at = statement_timestamp()
                            WHERE id = %s AND consumed_at IS NULL
                            """,
                            (verified["id"],),
                        )
                if (
                    verified is None
                    or verified["cancelled_at"] is not None
                    or verified["expires_at"] <= verified["db_now"]
                    or (
                        payload.verificationChallengeId is not None
                        and verified["consumed_at"] is None
                    )
                    or (
                        payload.verificationChallengeId is None
                        and verified["consumed_at"] is not None
                    )
                ):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail={"code": "AUTH_MFA_EMAIL_VERIFICATION_REQUIRED", "userMessage": "관리자 복구 확인이 필요합니다."},
                    )
                cursor.execute(
                    "SELECT id FROM admin_mfa_profiles WHERE user_id = %s FOR UPDATE",
                    (user.userId,),
                )
                profile = cursor.fetchone()
                profile_id = profile["id"] if profile is not None else uuid4().hex
                if profile is None:
                    cursor.execute(
                        "INSERT INTO admin_mfa_profiles (id, user_id) VALUES (%s, %s)",
                        (profile_id, user.userId),
                    )
                encrypted = self._mfa_service().encrypt_totp_seed(profile_id, user.userId, seed)
                cursor.execute(
                    """
                    UPDATE admin_mfa_challenges
                    SET cancelled_at = statement_timestamp()
                    WHERE user_id = %s AND purpose = 'enroll'
                      AND consumed_at IS NULL AND cancelled_at IS NULL
                    """,
                    (user.userId,),
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
                    RETURNING expires_at
                    """,
                    (
                        uuid4().hex,
                        challenge_hash,
                        user.userId,
                        verified["target_email"],
                        encrypted.keyVersion,
                        encrypted.nonce,
                        encrypted.ciphertext,
                        encrypted.tag,
                    ),
                )
                expires_at = cursor.fetchone()["expires_at"]
            connection.commit()
        return AdminMfaTotpStartResponse(
            challengeId=challenge_id,
            expiresAt=expires_at,
            manualKey=base64.b32encode(seed).decode("ascii").rstrip("="),
            qrPath="/api/v1/auth/admin/mfa/totp/qr",
        )

    def get_mfa_status(self, actor: AuthUserSummary) -> AdminMfaStatusResponse:
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT status, recovery_email, profile_version
                    FROM admin_mfa_profiles
                    WHERE user_id = %s
                    """,
                    (actor.userId,),
                )
                profile = cursor.fetchone()
        if profile is None:
            return AdminMfaStatusResponse(enrolled=False, status="not_enrolled")
        recovery_email = profile["recovery_email"]
        return AdminMfaStatusResponse(
            enrolled=profile["status"] == "active",
            status=profile["status"],
            recoveryEmailMasked=self._mask_email(recovery_email) if recovery_email else None,
            profileVersion=int(profile["profile_version"]),
        )

    def get_totp_qr(self, payload: AdminMfaTotpQrRequest) -> AdminMfaQrPng:
        challenge_hash = hashlib.sha256(payload.challengeId.encode("utf-8")).digest()
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT challenge.user_id, challenge.pending_totp_key_version,
                           challenge.pending_totp_nonce,
                           challenge.pending_totp_ciphertext,
                           challenge.pending_totp_tag, challenge.expires_at,
                           challenge.consumed_at, challenge.cancelled_at,
                           statement_timestamp() AS db_now,
                           profile.id AS profile_id, users.email
                    FROM admin_mfa_challenges AS challenge
                    JOIN admin_mfa_profiles AS profile ON profile.user_id = challenge.user_id
                    JOIN users ON users.id = challenge.user_id
                    WHERE challenge.challenge_hash = %s
                      AND challenge.purpose = 'enroll'
                    """,
                    (challenge_hash,),
                )
                row = cursor.fetchone()
        if (
            row is None
            or row["consumed_at"] is not None
            or row["cancelled_at"] is not None
            or row["expires_at"] <= row["db_now"]
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "AUTH_MFA_ENROLLMENT_INVALID", "userMessage": "인증 앱 등록 요청이 만료되었거나 올바르지 않습니다."},
            )
        encrypted = EncryptedMfaSecret(
            keyVersion=row["pending_totp_key_version"],
            nonce=bytes(row["pending_totp_nonce"]),
            ciphertext=bytes(row["pending_totp_ciphertext"]),
            tag=bytes(row["pending_totp_tag"]),
        )
        seed = self._mfa_service().decrypt_totp_seed(
            row["profile_id"], row["user_id"], encrypted
        )
        return self._mfa_service().build_totp_qr_png(
            account_name=row["email"], issuer="MoaWorks", secret=seed
        )

    @staticmethod
    def _mask_email(email: str) -> str:
        local, domain = email.split("@", 1)
        visible = local[:1]
        return f"{visible}{'*' * max(3, len(local) - 1)}@{domain}"

    def confirm_totp_enrollment(
        self,
        payload: AdminMfaTotpConfirmRequest,
    ) -> AdminMfaEnrollmentCompleted:
        mfa_service = self._mfa_service()
        challenge_hash = hashlib.sha256(payload.challengeId.encode("utf-8")).digest()
        try:
            with self.store.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, user_id, target_email, pending_totp_key_version,
                               pending_totp_nonce, pending_totp_ciphertext,
                               pending_totp_tag, expires_at, attempt_count,
                               consumed_at, cancelled_at,
                               statement_timestamp() AS db_now
                        FROM admin_mfa_challenges
                        WHERE challenge_hash = %s AND purpose = 'enroll'
                        FOR UPDATE
                        """,
                        (challenge_hash,),
                    )
                    challenge = cursor.fetchone()
                    eligible = (
                        challenge is not None
                        and challenge["consumed_at"] is None
                        and challenge["cancelled_at"] is None
                        and challenge["expires_at"] > challenge["db_now"]
                        and challenge["attempt_count"] < 5
                    )
                    if not eligible:
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "AUTH_MFA_ENROLLMENT_INVALID", "userMessage": "인증 앱 등록 요청이 만료되었거나 올바르지 않습니다."},
                        )
                    cursor.execute(
                        "SELECT id, profile_version FROM admin_mfa_profiles WHERE user_id = %s FOR UPDATE",
                        (challenge["user_id"],),
                    )
                    profile = cursor.fetchone()
                    if profile is None:
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "AUTH_MFA_ENROLLMENT_INVALID", "userMessage": "MFA profile을 찾을 수 없습니다."},
                        )
                    encrypted = EncryptedMfaSecret(
                        keyVersion=challenge["pending_totp_key_version"],
                        nonce=bytes(challenge["pending_totp_nonce"]),
                        ciphertext=bytes(challenge["pending_totp_ciphertext"]),
                        tag=bytes(challenge["pending_totp_tag"]),
                    )
                    seed = mfa_service.decrypt_totp_seed(
                        profile["id"], challenge["user_id"], encrypted
                    )
                    accepted_step = mfa_service.verify_totp(
                        seed,
                        payload.code,
                        at=challenge["db_now"],
                        last_accepted_step=None,
                    )
                    if accepted_step is None:
                        next_attempt = challenge["attempt_count"] + 1
                        cursor.execute(
                            """
                            UPDATE admin_mfa_challenges
                            SET attempt_count = %s,
                                cancelled_at = CASE
                                    WHEN %s >= 5 THEN statement_timestamp()
                                    ELSE cancelled_at
                                END
                            WHERE id = %s
                            """,
                            (next_attempt, next_attempt, challenge["id"]),
                        )
                        connection.commit()
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "AUTH_MFA_CODE_INVALID", "userMessage": "인증 앱 코드가 올바르지 않습니다."},
                        )

                    next_profile_version = int(profile["profile_version"]) + 1
                    cursor.execute(
                        """
                        UPDATE admin_mfa_profiles
                        SET recovery_email = %s,
                            recovery_email_verified_at = statement_timestamp(),
                            totp_key_version = %s,
                            totp_nonce = %s,
                            totp_ciphertext = %s,
                            totp_tag = %s,
                            profile_version = %s,
                            last_used_step = %s,
                            status = 'active',
                            activated_at = statement_timestamp(),
                            updated_at = statement_timestamp()
                        WHERE id = %s
                        """,
                        (
                            challenge["target_email"],
                            encrypted.keyVersion,
                            encrypted.nonce,
                            encrypted.ciphertext,
                            encrypted.tag,
                            next_profile_version,
                            accepted_step,
                            profile["id"],
                        ),
                    )
                    cursor.execute(
                        "DELETE FROM admin_mfa_recovery_codes WHERE profile_id = %s",
                        (profile["id"],),
                    )
                    recovery_codes = mfa_service.generate_recovery_codes(count=10)
                    for recovery_code in recovery_codes:
                        code_mac = mfa_service.recovery_code_mac(
                            profile["id"], challenge["user_id"], recovery_code
                        )
                        cursor.execute(
                            """
                            INSERT INTO admin_mfa_recovery_codes (
                                id, profile_id, code_key_version, code_mac
                            ) VALUES (%s, %s, %s, %s)
                            """,
                            (uuid4().hex, profile["id"], code_mac.keyVersion, code_mac.mac),
                        )
                    cursor.execute(
                        """
                        SELECT id, requested_user_type, requested_role_id, requested_status
                        FROM admin_mfa_invitations
                        WHERE target_user_id = %s
                          AND status = 'pending'
                          AND expires_at > statement_timestamp()
                        FOR UPDATE
                        """,
                        (challenge["user_id"],),
                    )
                    invitation = cursor.fetchone()
                    if invitation is not None:
                        cursor.execute(
                            """
                            UPDATE users
                            SET user_type = %s,
                                role_id = %s,
                                status = %s,
                                auth_session_version = auth_session_version + 1,
                                updated_at = statement_timestamp()
                            WHERE id = %s
                            """,
                            (
                                invitation["requested_user_type"],
                                invitation["requested_role_id"],
                                invitation["requested_status"],
                                challenge["user_id"],
                            ),
                        )
                        cursor.execute(
                            "UPDATE mail_accounts SET status = 'active', updated_at = statement_timestamp() WHERE user_id = %s",
                            (challenge["user_id"],),
                        )
                        cursor.execute(
                            """
                            UPDATE admin_mfa_invitations
                            SET status = 'completed', completed_at = statement_timestamp()
                            WHERE id = %s
                            """,
                            (invitation["id"],),
                        )
                    else:
                        cursor.execute(
                            """
                            UPDATE users
                            SET auth_session_version = auth_session_version + 1,
                                updated_at = statement_timestamp()
                            WHERE id = %s
                            """,
                            (challenge["user_id"],),
                        )
                    cursor.execute(
                        """
                        UPDATE admin_mfa_challenges
                        SET consumed_at = statement_timestamp()
                        WHERE id = %s AND consumed_at IS NULL AND cancelled_at IS NULL
                        RETURNING id
                        """,
                        (challenge["id"],),
                    )
                    if cursor.fetchone() is None:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "AUTH_MFA_ENROLLMENT_RACE", "userMessage": "인증 앱 등록 요청이 이미 사용되었습니다."},
                        )
                    cursor.execute(
                        """
                        UPDATE admin_mfa_challenges
                        SET cancelled_at = statement_timestamp()
                        WHERE user_id = %s
                          AND purpose IN ('admin_enrollment', 'mfa_reenroll')
                          AND consumed_at IS NULL AND cancelled_at IS NULL
                        """,
                        (challenge["user_id"],),
                    )
                    cursor.execute(
                        "SELECT required_epoch FROM admin_mfa_policy WHERE singleton = TRUE"
                    )
                    policy = cursor.fetchone()
                    if policy is None:
                        raise HTTPException(
                            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "ADMIN_MFA_POLICY_UNAVAILABLE", "userMessage": "관리자 인증 정책을 확인해 주세요."},
                        )
                    verified_at = challenge["db_now"]
                    user_id = challenge["user_id"]
                    policy_epoch = int(policy["required_epoch"])
                connection.commit()
        except CheckViolation as exc:
            if exc.sqlstate == "23514" and exc.diag.message_primary == "ADMIN_ACTIVE_LIMIT_REACHED":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "ADMIN_ACTIVE_LIMIT_REACHED", "userMessage": "활성 관리자 계정은 최대 3개까지 사용할 수 있습니다."},
                ) from exc
            raise

        user = self.store.get_user_summary(user_id)
        expires_in = 3600
        token = self.token_service.issue_access_token(
            user,
            expires_in=expires_in,
            mfa_profile_version=next_profile_version,
            mfa_policy_epoch=policy_epoch,
            mfa_verified_at=verified_at,
        )
        return AdminMfaEnrollmentCompleted(
            accessToken=token,
            tokenType="bearer",
            expiresIn=expires_in,
            user=user,
            recoveryCodes=recovery_codes,
        )

    def login(self, payload: LoginRequest) -> AuthLoginResponse:
        allowed_domain = self.store.get_login_domain()
        normalized_email = payload.email.strip().lower()
        if allowed_domain and not normalized_email.endswith(f"@{allowed_domain}"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_DOMAIN_NOT_ALLOWED",
                    "userMessage": "회사 도메인 계정만 로그인할 수 있습니다.",
                    "adminMessage": f"login domain not allowed: {normalized_email}",
                },
            )
        try:
            user = self.store.authenticate(payload.email, payload.password)
        except PermissionError as exc:
            try:
                user = self._authenticate_pending_admin(normalized_email, payload.password)
            except ValueError as pending_exc:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "code": "AUTH_LOGIN_FAILED",
                        "userMessage": str(pending_exc),
                        "adminMessage": str(pending_exc),
                    },
                ) from pending_exc
            except PermissionError:
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail={
                        "code": "AUTH_ACCOUNT_LOCKED",
                        "userMessage": str(exc),
                        "adminMessage": str(exc),
                    },
                ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_LOGIN_FAILED",
                    "userMessage": str(exc),
                    "adminMessage": str(exc),
                },
            ) from exc

        if (
            user.userType == "admin"
            or "admin:*" in user.permissions
            or self._has_pending_admin_invitation(user.userId)
        ):
            return self._issue_admin_login_or_enrollment_challenge(user)

        expires_in = 3600
        token = self.token_service.issue_access_token(user, expires_in=expires_in)
        return LoginResponse(
            accessToken=token,
            tokenType="bearer",
            expiresIn=expires_in,
            user=user,
        )

    def _authenticate_pending_admin(
        self,
        normalized_email: str,
        password: str,
    ) -> AuthUserSummary:
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                row = self.store._fetch_user_access_row(
                    cursor,
                    "LOWER(u.email) = %s",
                    (normalized_email,),
                )
        if row is None or row["user_status"] != "pending_mfa":
            raise PermissionError("사용할 수 없는 계정입니다.")
        if row["role_status"] != "active":
            raise PermissionError("사용자의 권한 역할이 비활성화되어 로그인할 수 없습니다.")
        if not self.store.security.verify_password(password, row["password_hash"]):
            raise ValueError("아이디 또는 비밀번호가 올바르지 않습니다.")
        return self.store._row_to_auth_summary(row)

    def _has_pending_admin_invitation(self, user_id: str) -> bool:
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT 1
                    FROM admin_mfa_invitations
                    WHERE target_user_id = %s
                      AND status = 'pending'
                      AND expires_at > statement_timestamp()
                    LIMIT 1
                    """,
                    (user_id,),
                )
                return cursor.fetchone() is not None

    def _issue_admin_login_or_enrollment_challenge(
        self,
        user: AuthUserSummary,
    ) -> AdminMfaRequired:
        self._mfa_service()
        challenge_id = secrets.token_urlsafe(24)
        challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
        self.store.db.ensure_migrations_applied()
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, status
                    FROM admin_mfa_profiles
                    WHERE user_id = %s
                    """,
                    (user.userId,),
                )
                profile = cursor.fetchone()
                is_active_profile = profile is not None and profile["status"] == "active"
                purpose = "login" if is_active_profile and user.status == "active" else "admin_enrollment"
                next_action = "mfa_required" if purpose == "login" else "mfa_enrollment_required"
                cursor.execute(
                    """
                    INSERT INTO admin_mfa_challenges (
                        id, challenge_hash, purpose, user_id, expires_at
                    ) VALUES (
                        %s, %s, %s, %s,
                        statement_timestamp() + interval '10 minutes'
                    )
                    RETURNING expires_at
                    """,
                    (uuid4().hex, challenge_hash, purpose, user.userId),
                )
                expires_at: datetime = cursor.fetchone()["expires_at"]
            connection.commit()
        return AdminMfaRequired(
            nextAction=next_action,
            challengeId=challenge_id,
            expiresAt=expires_at,
        )

    def verify_admin_mfa(self, payload: AdminMfaVerifyRequest) -> LoginResponse:
        mfa_service = self._mfa_service()
        challenge_hash = hashlib.sha256(payload.challengeId.encode("utf-8")).digest()
        self.store.db.ensure_migrations_applied()
        invalid = False
        with self.store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, purpose, user_id, expires_at, attempt_count,
                           consumed_at, cancelled_at,
                           statement_timestamp() AS db_now
                    FROM admin_mfa_challenges
                    WHERE challenge_hash = %s
                    FOR UPDATE
                    """,
                    (challenge_hash,),
                )
                challenge = cursor.fetchone()
                eligible = (
                    challenge is not None
                    and challenge["purpose"] == "login"
                    and challenge["consumed_at"] is None
                    and challenge["cancelled_at"] is None
                    and challenge["expires_at"] > challenge["db_now"]
                    and challenge["attempt_count"] < 5
                )
                if not eligible:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail={
                            "code": "AUTH_MFA_CHALLENGE_INVALID",
                            "userMessage": "관리자 인증 요청이 만료되었거나 올바르지 않습니다.",
                        },
                    )
                cursor.execute(
                    """
                    SELECT id, profile_version, totp_key_version, totp_nonce,
                           totp_ciphertext, totp_tag, last_used_step
                    FROM admin_mfa_profiles
                    WHERE user_id = %s AND status = 'active'
                    FOR UPDATE
                    """,
                    (challenge["user_id"],),
                )
                profile = cursor.fetchone()
                if profile is None:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail={
                            "code": "AUTH_MFA_PROFILE_REQUIRED",
                            "userMessage": "관리자 인증 등록이 필요합니다.",
                        },
                    )
                encrypted = EncryptedMfaSecret(
                    keyVersion=profile["totp_key_version"],
                    nonce=bytes(profile["totp_nonce"]),
                    ciphertext=bytes(profile["totp_ciphertext"]),
                    tag=bytes(profile["totp_tag"]),
                )
                seed = mfa_service.decrypt_totp_seed(
                    profile["id"], challenge["user_id"], encrypted
                )
                accepted_step = mfa_service.verify_totp(
                    seed,
                    payload.code,
                    at=challenge["db_now"],
                    last_accepted_step=profile["last_used_step"],
                )
                if accepted_step is None:
                    next_attempt = challenge["attempt_count"] + 1
                    cursor.execute(
                        """
                        UPDATE admin_mfa_challenges
                        SET attempt_count = %s,
                            cancelled_at = CASE
                                WHEN %s >= 5 THEN statement_timestamp()
                                ELSE cancelled_at
                            END
                        WHERE id = %s
                        """,
                        (next_attempt, next_attempt, challenge["id"]),
                    )
                    invalid = True
                    profile_version = int(profile["profile_version"])
                    policy_epoch = 0
                    verified_at = challenge["db_now"]
                    user_id = challenge["user_id"]
                else:
                    cursor.execute(
                        """
                        UPDATE admin_mfa_profiles
                        SET last_used_step = %s,
                            updated_at = statement_timestamp()
                        WHERE id = %s
                          AND (last_used_step IS NULL OR last_used_step < %s)
                        RETURNING id
                        """,
                        (accepted_step, profile["id"], accepted_step),
                    )
                    if cursor.fetchone() is None:
                        invalid = True
                    cursor.execute(
                        """
                        UPDATE admin_mfa_challenges
                        SET consumed_at = statement_timestamp()
                        WHERE id = %s AND consumed_at IS NULL AND cancelled_at IS NULL
                        RETURNING id
                        """,
                        (challenge["id"],),
                    )
                    if cursor.fetchone() is None:
                        invalid = True
                    cursor.execute(
                        "SELECT required_epoch FROM admin_mfa_policy WHERE singleton = TRUE"
                    )
                    policy = cursor.fetchone()
                    if policy is None:
                        raise HTTPException(
                            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "ADMIN_MFA_POLICY_UNAVAILABLE", "userMessage": "관리자 인증 정책을 확인해 주세요."},
                        )
                    profile_version = int(profile["profile_version"])
                    policy_epoch = int(policy["required_epoch"])
                    verified_at = challenge["db_now"]
                    user_id = challenge["user_id"]
            connection.commit()

        if invalid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "AUTH_MFA_CODE_INVALID",
                    "userMessage": "인증 앱 코드가 올바르지 않습니다.",
                },
            )
        user = self.store.get_user_summary(user_id)
        expires_in = 3600
        token = self.token_service.issue_access_token(
            user,
            expires_in=expires_in,
            mfa_profile_version=profile_version,
            mfa_policy_epoch=policy_epoch,
            mfa_verified_at=verified_at,
        )
        return LoginResponse(
            accessToken=token,
            tokenType="bearer",
            expiresIn=expires_in,
            user=user,
        )

    def verify_recovery(
        self,
        payload: AdminMfaRecoveryVerifyRequest,
    ) -> AdminMfaReenrollRequired:
        mfa_service = self._mfa_service()
        self.store.db.ensure_migrations_applied()
        if payload.recoveryCode is not None:
            with self.store.db.connect() as connection, connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT profile.id AS profile_id, users.id AS user_id,
                           profile.recovery_email AS target_email
                    FROM users
                    JOIN admin_mfa_profiles AS profile ON profile.user_id = users.id
                    WHERE LOWER(users.email) = %s
                      AND users.status = 'active'
                      AND profile.status = 'active'
                      AND profile.recovery_email_verified_at IS NOT NULL
                    """,
                    (payload.email,),
                )
                account = cursor.fetchone()
            consumed = account is not None and mfa_service.consume_recovery_code(
                profile_id=account["profile_id"],
                user_id=account["user_id"],
                code=payload.recoveryCode,
            )
            if not consumed:
                self._raise_invalid_mfa_recovery()
            user_id = account["user_id"]
            target_email = account["target_email"]
        else:
            assert payload.challengeId is not None and payload.code is not None
            challenge_hash = hashlib.sha256(payload.challengeId.encode("utf-8")).digest()
            with self.store.db.connect() as connection, connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id, target_email, expires_at, consumed_at,
                           cancelled_at, statement_timestamp() AS db_now
                    FROM admin_mfa_challenges
                    WHERE challenge_hash = %s AND purpose = 'recovery'
                    """,
                    (challenge_hash,),
                )
                challenge = cursor.fetchone()
            eligible = (
                challenge is not None
                and challenge["consumed_at"] is None
                and challenge["cancelled_at"] is None
                and challenge["expires_at"] > challenge["db_now"]
            )
            if not eligible:
                self._raise_invalid_mfa_recovery()
            user_id = challenge["user_id"]
            target_email = challenge["target_email"]
            if not mfa_service.consume_email_otp(
                payload.challengeId,
                user_id=user_id,
                purpose="recovery",
                email=target_email,
                code=payload.code,
            ):
                self._raise_invalid_mfa_recovery()

        reenroll_id = secrets.token_urlsafe(24)
        reenroll_hash = hashlib.sha256(reenroll_id.encode("utf-8")).digest()
        with self.store.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO admin_mfa_challenges (
                    id, challenge_hash, purpose, user_id, target_email, expires_at
                ) VALUES (
                    %s, %s, 'mfa_reenroll', %s, %s,
                    statement_timestamp() + interval '10 minutes'
                )
                RETURNING expires_at
                """,
                (uuid4().hex, reenroll_hash, user_id, target_email),
            )
            expires_at = cursor.fetchone()["expires_at"]
            connection.commit()
        return AdminMfaReenrollRequired(
            challengeId=reenroll_id,
            expiresAt=expires_at,
        )

    @staticmethod
    def _raise_invalid_mfa_recovery() -> None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_MFA_RECOVERY_INVALID",
                "userMessage": "복구 정보가 만료되었거나 올바르지 않습니다.",
            },
        )

    def change_password(self, user: AuthUserSummary, payload: PasswordChangeRequest) -> PasswordChangeResponse:
        with self.store.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT password_hash,status FROM users WHERE id=%s AND company_id=%s FOR UPDATE",
                (user.userId, user.companyId),
            )
            account = cursor.fetchone()
            if account is None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "AUTH_REQUIRED", "userMessage": "로그인이 필요합니다."})
            if account["status"] != "active":
                raise HTTPException(status_code=status.HTTP_423_LOCKED, detail={"code": "AUTH_ACCOUNT_LOCKED", "userMessage": "사용할 수 없는 계정입니다."})

            cursor.execute(
                "SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id=%s AND event='auth.password.change_failed' AND created_at >= NOW() - INTERVAL '15 minutes'",
                (user.userId,),
            )
            if int(cursor.fetchone()["count"]) >= 5:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail={"code": "AUTH_PASSWORD_RATE_LIMITED", "userMessage": "비밀번호 확인 시도가 많습니다. 잠시 후 다시 시도하세요."})

            if not self.store.security.verify_password(payload.currentPassword, account["password_hash"]):
                self.store._insert_audit(
                    cursor=cursor, company_id=user.companyId, actor_user_id=user.userId, actor_user_name=user.userName,
                    target_type="user", target_id=user.userId, event="auth.password.change_failed",
                    status_before="active", status_after="active", reason="current_password_mismatch",
                )
                connection.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "AUTH_CURRENT_PASSWORD_INVALID", "userMessage": "현재 비밀번호가 올바르지 않습니다."})

            password_hash = self.store.security.hash_password(payload.newPassword)
            cursor.execute("UPDATE users SET password_hash=%s,updated_at=NOW() WHERE id=%s AND company_id=%s", (password_hash, user.userId, user.companyId))
            cursor.execute("UPDATE users SET must_change_password=FALSE WHERE id=%s AND company_id=%s", (user.userId, user.companyId))
            self.store._insert_audit(
                cursor=cursor, company_id=user.companyId, actor_user_id=user.userId, actor_user_name=user.userName,
                target_type="user", target_id=user.userId, event="auth.password.changed",
                status_before="active", status_after="active", reason="self_service",
            )
            connection.commit()
        return PasswordChangeResponse(message="비밀번호를 변경했습니다.", user=self.store.get_user_summary(user.userId))

