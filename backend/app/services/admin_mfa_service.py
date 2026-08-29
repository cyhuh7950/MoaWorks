from __future__ import annotations

import base64
from datetime import UTC, datetime
import hashlib
import hmac
from io import BytesIO
import json
import secrets
import struct
from typing import Callable, Mapping
from urllib.parse import quote, urlencode
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings
from app.schemas.admin_mfa import (
    AdminMfaMac,
    AdminMfaQrPng,
    EncryptedMfaSecret,
    IssuedEmailOtp,
)
from app.services.postgres_service import PostgresService


class AdminMfaConfigurationError(RuntimeError):
    pass


class AdminMfaNonceReuseError(RuntimeError):
    pass


class AdminMfaService:
    TOTP_STEP_SECONDS = 30
    TOTP_DIGITS = 6
    _PLACEHOLDER_FRAGMENTS = ("change-me", "replace-with", "example-secret")

    def __init__(
        self,
        *,
        totp_current_key_version: int,
        totp_keys: Mapping[int, bytes],
        otp_current_key_version: int,
        otp_hmac_keys: Mapping[int, bytes],
        recovery_current_key_version: int,
        recovery_hmac_keys: Mapping[int, bytes],
        nonce_factory: Callable[[], bytes] = lambda: secrets.token_bytes(12),
        db: PostgresService | None = None,
    ) -> None:
        self._totp_current_key_version = totp_current_key_version
        self._totp_keys = self._validate_keys("TOTP", totp_keys)
        self._otp_current_key_version = otp_current_key_version
        self._otp_hmac_keys = self._validate_keys("OTP", otp_hmac_keys)
        self._recovery_current_key_version = recovery_current_key_version
        self._recovery_hmac_keys = self._validate_keys("recovery", recovery_hmac_keys)
        self._nonce_factory = nonce_factory
        self._db = db
        self._issued_nonces: set[tuple[int, bytes]] = set()

        self._require_current_key("TOTP", self._totp_current_key_version, self._totp_keys)
        self._require_current_key("OTP", self._otp_current_key_version, self._otp_hmac_keys)
        self._require_current_key(
            "recovery", self._recovery_current_key_version, self._recovery_hmac_keys
        )

    def __repr__(self) -> str:
        return (
            "AdminMfaService("
            f"totp_current_key_version={self._totp_current_key_version}, "
            f"totp_key_versions={sorted(self._totp_keys)}, "
            f"otp_key_versions={sorted(self._otp_hmac_keys)}, "
            f"recovery_key_versions={sorted(self._recovery_hmac_keys)})"
        )

    @classmethod
    def from_encoded_secrets(
        cls,
        *,
        enforcement: str,
        endpoint_used: bool,
        totp_current_key_version: int,
        totp_keyring: str,
        otp_hmac_keyring: str,
        recovery_hmac_keyring: str,
    ) -> "AdminMfaService | None":
        required = enforcement == "required" or endpoint_used
        encoded_values = (totp_keyring, otp_hmac_keyring, recovery_hmac_keyring)
        if not required and not any(value.strip() for value in encoded_values):
            return None
        if enforcement not in {"optional", "required"}:
            raise AdminMfaConfigurationError("MFA 적용 모드가 올바르지 않습니다.")
        if any(cls._is_missing_or_placeholder(value) for value in encoded_values):
            raise AdminMfaConfigurationError("MFA Secret 설정이 비어 있거나 예시 값입니다.")

        totp_keys = cls._decode_keyring(totp_keyring)
        otp_keys = cls._decode_keyring(otp_hmac_keyring)
        recovery_keys = cls._decode_keyring(recovery_hmac_keyring)
        return cls(
            totp_current_key_version=totp_current_key_version,
            totp_keys=totp_keys,
            otp_current_key_version=max(otp_keys),
            otp_hmac_keys=otp_keys,
            recovery_current_key_version=max(recovery_keys),
            recovery_hmac_keys=recovery_keys,
        )

    @classmethod
    def from_settings(cls, *, endpoint_used: bool = False) -> "AdminMfaService | None":
        return cls.from_encoded_secrets(
            enforcement=settings.admin_mfa_enforcement,
            endpoint_used=endpoint_used,
            totp_current_key_version=settings.admin_mfa_totp_current_key_version,
            totp_keyring=settings.admin_mfa_totp_keyring,
            otp_hmac_keyring=cls._single_encoded_keyring(settings.admin_mfa_otp_hmac_key),
            recovery_hmac_keyring=cls._single_encoded_keyring(
                settings.admin_mfa_recovery_code_hmac_key
            ),
        )

    def email_otp_mac(
        self,
        *,
        key_version: int | None = None,
        purpose: str,
        challenge_id: str,
        user_id: str,
        email: str,
        code: str,
    ) -> AdminMfaMac:
        version = key_version or self._otp_current_key_version
        key = self._require_key("OTP", version, self._otp_hmac_keys)
        material = "\x1f".join(
            (str(version), purpose, challenge_id, user_id, email.strip().lower(), code)
        ).encode("utf-8")
        return AdminMfaMac(
            keyVersion=version,
            mac=hmac.new(key, material, hashlib.sha256).digest(),
        )

    def email_otp_matches(self, expected_mac: AdminMfaMac, **values: object) -> bool:
        try:
            candidate = self.email_otp_mac(**values)
        except AdminMfaConfigurationError:
            return False
        return hmac.compare_digest(expected_mac.mac, candidate.mac)

    def recovery_code_mac(
        self,
        profile_id: str,
        user_id: str,
        code: str,
        *,
        key_version: int | None = None,
    ) -> AdminMfaMac:
        version = key_version or self._recovery_current_key_version
        key = self._require_key("recovery", version, self._recovery_hmac_keys)
        material = "\x1f".join((str(version), profile_id, user_id, code)).encode("utf-8")
        return AdminMfaMac(
            keyVersion=version,
            mac=hmac.new(key, material, hashlib.sha256).digest(),
        )

    def recovery_code_matches(
        self,
        expected_mac: bytes,
        *,
        key_version: int,
        profile_id: str,
        user_id: str,
        code: str,
    ) -> bool:
        try:
            candidate = self.recovery_code_mac(
                profile_id, user_id, code, key_version=key_version
            )
        except AdminMfaConfigurationError:
            return False
        return hmac.compare_digest(expected_mac, candidate.mac)

    def generate_recovery_codes(self, *, count: int = 10) -> list[str]:
        if not 1 <= count <= 20:
            raise ValueError("복구 코드는 1개 이상 20개 이하로 발급할 수 있습니다.")
        codes: set[str] = set()
        while len(codes) < count:
            codes.add(base64.urlsafe_b64encode(secrets.token_bytes(16)).rstrip(b"=").decode())
        return list(codes)

    def issue_email_otp(
        self,
        *,
        user_id: str,
        purpose: str,
        email: str,
        code: str | None = None,
        ttl_seconds: int = 600,
    ) -> IssuedEmailOtp:
        if purpose not in {"email_verify", "recovery"}:
            raise ValueError("이메일 OTP 목적이 올바르지 않습니다.")
        normalized_email = email.strip().lower()
        if "@" not in normalized_email:
            raise ValueError("복구 이메일 형식이 올바르지 않습니다.")
        if not 1 <= ttl_seconds <= 600:
            raise ValueError("이메일 OTP 만료 시간은 1초 이상 600초 이하여야 합니다.")
        actual_code = code or f"{secrets.randbelow(1_000_000):06d}"
        if len(actual_code) != 6 or not actual_code.isdigit():
            raise ValueError("이메일 OTP는 6자리 숫자여야 합니다.")

        db = self._require_db()
        db.ensure_migrations_applied()
        challenge_id = secrets.token_urlsafe(24)
        challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
        code_mac = self.email_otp_mac(
            purpose=purpose,
            challenge_id=challenge_id,
            user_id=user_id,
            email=normalized_email,
            code=actual_code,
        )
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO admin_mfa_challenges (
                        id, challenge_hash, purpose, user_id, target_email,
                        code_key_version, code_mac, expires_at, resend_not_before
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s,
                        statement_timestamp() + make_interval(secs => %s),
                        statement_timestamp() + interval '60 seconds'
                    )
                    RETURNING expires_at
                    """,
                    (
                        uuid4().hex,
                        challenge_hash,
                        purpose,
                        user_id,
                        normalized_email,
                        code_mac.keyVersion,
                        code_mac.mac,
                        ttl_seconds,
                    ),
                )
                expires_at = cursor.fetchone()["expires_at"]
            connection.commit()
        return IssuedEmailOtp(
            challengeId=challenge_id,
            code=actual_code,
            expiresAt=expires_at,
        )

    def consume_email_otp(
        self,
        challenge_id: str,
        *,
        user_id: str,
        purpose: str,
        email: str,
        code: str,
    ) -> bool:
        db = self._require_db()
        db.ensure_migrations_applied()
        challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
        normalized_email = email.strip().lower()
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, purpose, user_id, target_email, code_key_version,
                           code_mac, expires_at, attempt_count, consumed_at,
                           cancelled_at, statement_timestamp() AS db_now
                    FROM admin_mfa_challenges
                    WHERE challenge_hash = %s
                    FOR UPDATE
                    """,
                    (challenge_hash,),
                )
                row = cursor.fetchone()
                if row is None:
                    return False
                eligible = (
                    row["consumed_at"] is None
                    and row["cancelled_at"] is None
                    and row["expires_at"] > row["db_now"]
                    and row["attempt_count"] < 5
                )
                matches = eligible and (
                    row["purpose"] == purpose
                    and row["user_id"] == user_id
                    and row["target_email"] == normalized_email
                    and self.email_otp_matches(
                        AdminMfaMac(
                            keyVersion=row["code_key_version"], mac=bytes(row["code_mac"])
                        ),
                        key_version=row["code_key_version"],
                        purpose=purpose,
                        challenge_id=challenge_id,
                        user_id=user_id,
                        email=normalized_email,
                        code=code,
                    )
                )
                if matches:
                    cursor.execute(
                        """
                        UPDATE admin_mfa_challenges
                        SET consumed_at = statement_timestamp()
                        WHERE id = %s AND consumed_at IS NULL AND cancelled_at IS NULL
                        RETURNING id
                        """,
                        (row["id"],),
                    )
                    consumed = cursor.fetchone() is not None
                    connection.commit()
                    return consumed
                if eligible:
                    next_attempt = row["attempt_count"] + 1
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
                        (next_attempt, next_attempt, row["id"]),
                    )
            connection.commit()
        return False

    def issue_recovery_codes(
        self,
        *,
        profile_id: str,
        user_id: str,
        count: int = 10,
    ) -> list[str]:
        db = self._require_db()
        db.ensure_migrations_applied()
        codes = self.generate_recovery_codes(count=count)
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM admin_mfa_profiles WHERE id = %s AND user_id = %s FOR UPDATE",
                    (profile_id, user_id),
                )
                if cursor.fetchone() is None:
                    raise ValueError("MFA profile을 찾을 수 없습니다.")
                for code in codes:
                    code_mac = self.recovery_code_mac(profile_id, user_id, code)
                    cursor.execute(
                        """
                        INSERT INTO admin_mfa_recovery_codes (
                            id, profile_id, code_key_version, code_mac
                        ) VALUES (%s, %s, %s, %s)
                        """,
                        (uuid4().hex, profile_id, code_mac.keyVersion, code_mac.mac),
                    )
            connection.commit()
        return codes

    def consume_recovery_code(
        self,
        *,
        profile_id: str,
        user_id: str,
        code: str,
    ) -> bool:
        db = self._require_db()
        db.ensure_migrations_applied()
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT recovery.id, recovery.code_key_version, recovery.code_mac
                    FROM admin_mfa_recovery_codes AS recovery
                    JOIN admin_mfa_profiles AS profile ON profile.id = recovery.profile_id
                    WHERE recovery.profile_id = %s
                      AND profile.user_id = %s
                      AND recovery.used_at IS NULL
                    ORDER BY recovery.id
                    FOR UPDATE OF recovery
                    """,
                    (profile_id, user_id),
                )
                matched_id: str | None = None
                for row in cursor.fetchall():
                    if self.recovery_code_matches(
                        bytes(row["code_mac"]),
                        key_version=row["code_key_version"],
                        profile_id=profile_id,
                        user_id=user_id,
                        code=code,
                    ):
                        matched_id = row["id"]
                if matched_id is None:
                    return False
                cursor.execute(
                    """
                    UPDATE admin_mfa_recovery_codes
                    SET used_at = statement_timestamp()
                    WHERE id = %s AND used_at IS NULL
                    RETURNING id
                    """,
                    (matched_id,),
                )
                consumed = cursor.fetchone() is not None
            connection.commit()
        return consumed

    def consume_profile_totp(
        self,
        *,
        profile_id: str,
        user_id: str,
        code: str,
        at: datetime | None = None,
    ) -> bool:
        db = self._require_db()
        db.ensure_migrations_applied()
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, totp_key_version, totp_nonce, totp_ciphertext,
                           totp_tag, last_used_step, statement_timestamp() AS db_now
                    FROM admin_mfa_profiles
                    WHERE id = %s AND user_id = %s AND status = 'active'
                    FOR UPDATE
                    """,
                    (profile_id, user_id),
                )
                row = cursor.fetchone()
                if row is None or any(
                    row[field] is None
                    for field in (
                        "totp_key_version",
                        "totp_nonce",
                        "totp_ciphertext",
                        "totp_tag",
                    )
                ):
                    return False
                encrypted = EncryptedMfaSecret(
                    keyVersion=row["totp_key_version"],
                    nonce=bytes(row["totp_nonce"]),
                    ciphertext=bytes(row["totp_ciphertext"]),
                    tag=bytes(row["totp_tag"]),
                )
                seed = self.decrypt_totp_seed(profile_id, user_id, encrypted)
                accepted_step = self.verify_totp(
                    seed,
                    code,
                    at=at or row["db_now"],
                    last_accepted_step=row["last_used_step"],
                )
                if accepted_step is None:
                    return False
                cursor.execute(
                    """
                    UPDATE admin_mfa_profiles
                    SET last_used_step = %s,
                        updated_at = statement_timestamp()
                    WHERE id = %s
                      AND user_id = %s
                      AND (last_used_step IS NULL OR last_used_step < %s)
                    RETURNING id
                    """,
                    (accepted_step, profile_id, user_id, accepted_step),
                )
                consumed = cursor.fetchone() is not None
            connection.commit()
        return consumed

    def encrypt_totp_seed(
        self,
        profile_id: str,
        user_id: str,
        seed: bytes,
    ) -> EncryptedMfaSecret:
        version = self._totp_current_key_version
        key = self._require_key("TOTP", version, self._totp_keys)
        nonce = self._nonce_factory()
        if len(nonce) != 12:
            raise AdminMfaConfigurationError("TOTP nonce는 12 bytes여야 합니다.")
        nonce_key = (version, nonce)
        if nonce_key in self._issued_nonces:
            raise AdminMfaNonceReuseError("동일 key version에서 nonce를 재사용할 수 없습니다.")
        self._issued_nonces.add(nonce_key)
        encrypted = AESGCM(key).encrypt(nonce, seed, self._totp_aad(profile_id, user_id, version))
        return EncryptedMfaSecret(
            keyVersion=version,
            nonce=nonce,
            ciphertext=encrypted[:-16],
            tag=encrypted[-16:],
        )

    def decrypt_totp_seed(
        self,
        profile_id: str,
        user_id: str,
        encrypted: EncryptedMfaSecret,
    ) -> bytes:
        key = self._require_key("TOTP", encrypted.keyVersion, self._totp_keys)
        return AESGCM(key).decrypt(
            encrypted.nonce,
            encrypted.ciphertext + encrypted.tag,
            self._totp_aad(profile_id, user_id, encrypted.keyVersion),
        )

    def totp_code(self, seed: bytes, *, at: datetime | None = None) -> str:
        moment = at or datetime.now(UTC)
        step = int(moment.timestamp()) // self.TOTP_STEP_SECONDS
        return self._hotp(seed, step)

    def verify_totp(
        self,
        seed: bytes,
        code: str,
        *,
        at: datetime | None = None,
        last_accepted_step: int | None,
        window: int = 1,
    ) -> int | None:
        if len(code) != self.TOTP_DIGITS or not code.isdigit():
            return None
        moment = at or datetime.now(UTC)
        current_step = int(moment.timestamp()) // self.TOTP_STEP_SECONDS
        for step in range(current_step - window, current_step + window + 1):
            if last_accepted_step is not None and step <= last_accepted_step:
                continue
            if hmac.compare_digest(self._hotp(seed, step), code):
                return step
        return None

    def build_totp_qr_png(
        self,
        *,
        account_name: str,
        issuer: str,
        secret: bytes,
    ) -> AdminMfaQrPng:
        try:
            import qrcode
        except ImportError as exc:
            raise AdminMfaConfigurationError("QR 생성 dependency가 설치되지 않았습니다.") from exc

        encoded_secret = base64.b32encode(secret).decode("ascii").rstrip("=")
        label = quote(f"{issuer}:{account_name}", safe="")
        query = urlencode(
            {
                "secret": encoded_secret,
                "issuer": issuer,
                "algorithm": "SHA1",
                "digits": str(self.TOTP_DIGITS),
                "period": str(self.TOTP_STEP_SECONDS),
            }
        )
        image = qrcode.make(f"otpauth://totp/{label}?{query}")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return AdminMfaQrPng(
            pngBytes=buffer.getvalue(),
            headers={
                "Cache-Control": "no-store, max-age=0",
                "Pragma": "no-cache",
                "Referrer-Policy": "no-referrer",
            },
        )

    @staticmethod
    def _hotp(seed: bytes, step: int) -> str:
        digest = hmac.new(seed, struct.pack(">Q", step), hashlib.sha1).digest()
        offset = digest[-1] & 0x0F
        binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
        return f"{binary % 1_000_000:06d}"

    @staticmethod
    def _totp_aad(profile_id: str, user_id: str, key_version: int) -> bytes:
        return f"moaworks-admin-mfa:v1|{profile_id}|{user_id}|{key_version}".encode()

    @classmethod
    def _is_missing_or_placeholder(cls, value: str) -> bool:
        normalized = value.strip().lower()
        return not normalized or any(fragment in normalized for fragment in cls._PLACEHOLDER_FRAGMENTS)

    @staticmethod
    def _validate_keys(label: str, keys: Mapping[int, bytes]) -> dict[int, bytes]:
        validated: dict[int, bytes] = {}
        for version, key in keys.items():
            if version <= 0 or len(key) != 32:
                raise AdminMfaConfigurationError(
                    f"{label} key version은 양수이고 key는 32 bytes여야 합니다."
                )
            validated[int(version)] = bytes(key)
        return validated

    @staticmethod
    def _require_current_key(label: str, version: int, keys: Mapping[int, bytes]) -> None:
        if version not in keys:
            raise AdminMfaConfigurationError(f"{label} current key version이 keyring에 없습니다.")

    @staticmethod
    def _require_key(label: str, version: int, keys: Mapping[int, bytes]) -> bytes:
        key = keys.get(version)
        if key is None:
            raise AdminMfaConfigurationError(f"{label} decrypt key version을 찾을 수 없습니다.")
        return key

    @classmethod
    def _decode_keyring(cls, encoded: str) -> dict[int, bytes]:
        try:
            payload = json.loads(encoded)
            if not isinstance(payload, dict) or not payload:
                raise ValueError
            decoded = {
                int(version): base64.b64decode(value, validate=True)
                for version, value in payload.items()
            }
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise AdminMfaConfigurationError("MFA keyring 형식이 올바르지 않습니다.") from exc
        return cls._validate_keys("MFA", decoded)

    @staticmethod
    def _single_encoded_keyring(encoded_key: str) -> str:
        if not encoded_key.strip():
            return ""
        return json.dumps({"1": encoded_key})

    def _require_db(self) -> PostgresService:
        if self._db is None:
            raise AdminMfaConfigurationError("MFA DB service가 설정되지 않았습니다.")
        return self._db
