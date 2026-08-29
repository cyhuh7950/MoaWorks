from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import stat
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Mapping
from uuid import uuid4

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from app.core.config import settings
from app.services.postgres_service import PostgresService


class BreakGlassError(RuntimeError):
    pass


class BreakGlassApprovalInvalid(BreakGlassError):
    pass


class BreakGlassApprovalRequired(BreakGlassError):
    pass


class BreakGlassRequestUnavailable(BreakGlassError):
    pass


@dataclass(frozen=True)
class BreakGlassApprover:
    approver_id: str
    key_version: int
    public_key: bytes
    active: bool = True
    bound_user_id: str | None = None


@dataclass(frozen=True)
class BreakGlassExecution:
    request_id: str
    purpose: str
    expires_in_seconds: int
    challenge_output: Path


class AdminMfaBreakGlassService:
    VERSION = "v1"
    DEFAULT_EXPIRY_MINUTES = 15
    REENROLL_TTL_SECONDS = 600

    def __init__(self, *, db: PostgresService | None, approvers: Mapping[str, BreakGlassApprover], repository_root: Path | None = None) -> None:
        self.db = db
        self.approvers = dict(approvers)
        self.repository_root = (repository_root or Path(__file__).resolve().parents[3]).resolve()

    @classmethod
    def from_settings(cls, *, db: PostgresService | None = None) -> "AdminMfaBreakGlassService":
        raw = settings.admin_mfa_break_glass_approver_keyring.strip()
        if not raw:
            raise BreakGlassApprovalInvalid("복구 담당자 public keyring이 설정되지 않았습니다.")
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BreakGlassApprovalInvalid("복구 담당자 public keyring 형식이 올바르지 않습니다.") from exc
        if not isinstance(decoded, dict):
            raise BreakGlassApprovalInvalid("복구 담당자 public keyring은 객체여야 합니다.")
        approvers: dict[str, BreakGlassApprover] = {}
        for approver_id, value in decoded.items():
            if not isinstance(value, dict):
                raise BreakGlassApprovalInvalid("복구 담당자 key 항목 형식이 올바르지 않습니다.")
            try:
                public_key = base64.b64decode(str(value["publicKey"]), validate=True)
                key_version = int(value["keyVersion"])
            except (KeyError, ValueError, TypeError) as exc:
                raise BreakGlassApprovalInvalid("복구 담당자 key 항목이 불완전합니다.") from exc
            if len(public_key) != 32 or key_version < 1:
                raise BreakGlassApprovalInvalid("Ed25519 public key 또는 version이 올바르지 않습니다.")
            approvers[str(approver_id)] = BreakGlassApprover(
                approver_id=str(approver_id), key_version=key_version, public_key=public_key,
                active=bool(value.get("active", False)),
                bound_user_id=str(value["boundUserId"]) if value.get("boundUserId") else None,
            )
        return cls(db=db or PostgresService(), approvers=approvers)

    @staticmethod
    def _iso(value: datetime) -> str:
        return value.astimezone(UTC).isoformat()

    @classmethod
    def canonical_payload(cls, request: Mapping[str, object]) -> bytes:
        required = ("version", "requestId", "targetUserId", "reasonDigest", "correlationId", "expiresAt", "nonce")
        try:
            values = [str(request[key]) for key in required]
        except KeyError as exc:
            raise BreakGlassApprovalInvalid("복구 요청 payload가 불완전합니다.") from exc
        if values[0] != cls.VERSION or any("|" in value for value in values):
            raise BreakGlassApprovalInvalid("복구 요청 payload를 canonicalize할 수 없습니다.")
        if "reason" in request:
            actual_reason_digest = hashlib.sha256(str(request["reason"]).encode("utf-8")).hexdigest()
            if not hmac.compare_digest(actual_reason_digest, values[3]):
                raise BreakGlassApprovalInvalid("복구 사유와 reason digest가 일치하지 않습니다.")
        return "|".join(values).encode("utf-8")

    @classmethod
    def sign_request(cls, request: Mapping[str, object], *, approver_id: str, key_version: int, private_key: bytes | Ed25519PrivateKey) -> dict[str, object]:
        key = private_key if isinstance(private_key, Ed25519PrivateKey) else Ed25519PrivateKey.from_private_bytes(private_key)
        payload = cls.canonical_payload(request)
        digest = hashlib.sha256(payload).digest()
        return {
            "version": cls.VERSION, "requestId": str(request["requestId"]),
            "approverId": approver_id, "keyVersion": key_version,
            "payloadDigest": digest.hex(),
            "detachedSignature": base64.b64encode(key.sign(payload)).decode("ascii"),
        }

    @staticmethod
    def load_private_key(path: Path) -> Ed25519PrivateKey:
        raw = path.read_bytes()
        try:
            loaded = serialization.load_pem_private_key(raw, password=None)
            if not isinstance(loaded, Ed25519PrivateKey):
                raise BreakGlassApprovalInvalid("private key는 Ed25519 형식이어야 합니다.")
            return loaded
        except ValueError:
            pass
        if len(raw) == 32:
            return Ed25519PrivateKey.from_private_bytes(raw)
        stripped = raw.strip()
        try:
            decoded = base64.b64decode(stripped, validate=True)
        except ValueError as exc:
            raise BreakGlassApprovalInvalid("private key 파일 형식이 올바르지 않습니다.") from exc
        if len(decoded) != 32:
            raise BreakGlassApprovalInvalid("private key는 32-byte Ed25519 seed여야 합니다.")
        return Ed25519PrivateKey.from_private_bytes(decoded)

    def validate_approval(self, request: Mapping[str, object], approval: Mapping[str, object]) -> BreakGlassApprover:
        approver_id = str(approval.get("approverId", ""))
        approver = self.approvers.get(approver_id)
        if approver is None or not approver.active:
            raise BreakGlassApprovalInvalid("활성 복구 담당자 서명이 아닙니다.")
        if approver.bound_user_id and approver.bound_user_id == str(request.get("targetUserId", "")):
            raise BreakGlassApprovalInvalid("대상 계정에 귀속된 담당자는 자기승인할 수 없습니다.")
        if str(approval.get("requestId", "")) != str(request.get("requestId", "")):
            raise BreakGlassApprovalInvalid("승인 request가 일치하지 않습니다.")
        try:
            supplied_key_version = int(approval.get("keyVersion", 0))
        except (TypeError, ValueError) as exc:
            raise BreakGlassApprovalInvalid("승인 key version 형식이 올바르지 않습니다.") from exc
        if supplied_key_version != approver.key_version:
            raise BreakGlassApprovalInvalid("승인 key version이 일치하지 않습니다.")
        payload = self.canonical_payload(request)
        digest = hashlib.sha256(payload).digest()
        try:
            supplied_digest = bytes.fromhex(str(approval.get("payloadDigest", "")))
            signature = base64.b64decode(str(approval.get("detachedSignature", "")), validate=True)
        except (ValueError, TypeError) as exc:
            raise BreakGlassApprovalInvalid("승인 서명 encoding이 올바르지 않습니다.") from exc
        if not hmac.compare_digest(digest, supplied_digest):
            raise BreakGlassApprovalInvalid("승인 payload digest가 일치하지 않습니다.")
        try:
            Ed25519PublicKey.from_public_bytes(approver.public_key).verify(signature, payload)
        except (InvalidSignature, ValueError) as exc:
            raise BreakGlassApprovalInvalid("승인 서명이 올바르지 않습니다.") from exc
        return approver

    def create_request(self, *, target_user_id: str, reason: str, correlation_id: str, expires_in_minutes: int = DEFAULT_EXPIRY_MINUTES) -> dict[str, object]:
        db = self._require_db()
        normalized_reason = reason.strip()
        normalized_correlation = correlation_id.strip()
        if not normalized_reason or not normalized_correlation:
            raise ValueError("reason과 correlation id는 필수입니다.")
        if not 1 <= expires_in_minutes <= 60:
            raise ValueError("복구 요청 만료는 1~60분이어야 합니다.")
        db.ensure_migrations_applied()
        request_id = f"bg_{uuid4().hex}"
        nonce = secrets.token_bytes(24)
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO admin_mfa_break_glass_requests (
                    request_id,target_user_id,reason,correlation_id,nonce,expires_at
                ) VALUES (%s,%s,%s,%s,%s,statement_timestamp()+make_interval(mins => %s))
                RETURNING expires_at
                """,
                (request_id, target_user_id, normalized_reason, normalized_correlation, nonce, expires_in_minutes),
            )
            expires_at = cursor.fetchone()["expires_at"]
            self._audit(cursor, target_user_id=target_user_id, request_id=request_id,
                        event="admin.mfa.break_glass.requested", before=None, after="pending",
                        correlation_id=normalized_correlation)
            connection.commit()
        return self._request_artifact(request_id=request_id, target_user_id=target_user_id,
                                      reason=normalized_reason, correlation_id=normalized_correlation,
                                      expires_at=expires_at, nonce=nonce)

    def approve(self, request_id: str, approval: Mapping[str, object]) -> None:
        try:
            self._approve(request_id, approval)
        except BreakGlassApprovalInvalid:
            self._audit_failure(request_id, "admin.mfa.break_glass.approval_rejected")
            raise

    def _approve(self, request_id: str, approval: Mapping[str, object]) -> None:
        db = self._require_db()
        db.ensure_migrations_applied()
        with db.connect() as connection, connection.cursor() as cursor:
            row = self._lock_request(cursor, request_id)
            request = self._artifact_from_row(row)
            approver = self.validate_approval(request, approval)
            try:
                cursor.execute(
                    """
                    INSERT INTO admin_mfa_break_glass_approvals (
                        id,request_id,approver_id,key_version,payload_digest,detached_signature
                    ) VALUES (%s,%s,%s,%s,%s,%s)
                    """,
                    (f"bga_{uuid4().hex}", request_id, approver.approver_id, approver.key_version,
                     bytes.fromhex(str(approval["payloadDigest"])),
                     base64.b64decode(str(approval["detachedSignature"]), validate=True)),
                )
            except Exception as exc:
                if getattr(exc, "sqlstate", None) == "23505":
                    raise BreakGlassApprovalInvalid("같은 복구 담당자의 중복 승인은 허용되지 않습니다.") from exc
                raise
            self._audit(cursor, target_user_id=row["target_user_id"], request_id=request_id,
                        event="admin.mfa.break_glass.approved", before="pending", after="pending",
                        correlation_id=row["correlation_id"], approver_id=approver.approver_id)
            connection.commit()

    def cancel(self, request_id: str, *, reason: str) -> None:
        db = self._require_db()
        if not reason.strip():
            raise ValueError("취소 사유가 필요합니다.")
        with db.connect() as connection, connection.cursor() as cursor:
            row = self._lock_request(cursor, request_id)
            cursor.execute(
                """
                UPDATE admin_mfa_break_glass_requests
                SET status='cancelled',cancelled_at=statement_timestamp()
                WHERE request_id=%s AND status='pending'
                """,
                (request_id,),
            )
            if cursor.rowcount != 1:
                raise BreakGlassRequestUnavailable("대기 중인 복구 요청이 아닙니다.")
            self._audit(cursor, target_user_id=row["target_user_id"], request_id=request_id,
                        event="admin.mfa.break_glass.cancelled", before="pending", after="cancelled",
                        correlation_id=row["correlation_id"],
                        action_reason_digest=hashlib.sha256(reason.strip().encode("utf-8")).hexdigest())
            connection.commit()

    def execute(self, request_id: str, *, challenge_output: Path) -> BreakGlassExecution:
        output = challenge_output.resolve()
        self._validate_output_path(output)
        db = self._require_db()
        created_output = False
        connection = db.connect()
        try:
            with connection.cursor() as cursor:
                row = self._lock_request(cursor, request_id)
                request = self._artifact_from_row(row)
                cursor.execute(
                    """
                    SELECT approver_id,key_version,payload_digest,detached_signature
                    FROM admin_mfa_break_glass_approvals
                    WHERE request_id=%s ORDER BY approver_id
                    """,
                    (request_id,),
                )
                valid_ids: set[str] = set()
                for approval_row in cursor.fetchall():
                    approval = {
                        "version": self.VERSION, "requestId": request_id,
                        "approverId": approval_row["approver_id"],
                        "keyVersion": approval_row["key_version"],
                        "payloadDigest": bytes(approval_row["payload_digest"]).hex(),
                        "detachedSignature": base64.b64encode(bytes(approval_row["detached_signature"])).decode("ascii"),
                    }
                    valid_ids.add(self.validate_approval(request, approval).approver_id)
                if len(valid_ids) < 2:
                    raise BreakGlassApprovalRequired("서로 다른 활성 복구 담당자 2명의 승인이 필요합니다.")

                challenge_id = secrets.token_urlsafe(32)
                challenge_hash = hashlib.sha256(challenge_id.encode("utf-8")).digest()
                challenge_row_id = f"mfac_{uuid4().hex}"
                cursor.execute(
                    """
                    UPDATE admin_mfa_challenges SET cancelled_at=statement_timestamp()
                    WHERE user_id=%s AND consumed_at IS NULL AND cancelled_at IS NULL
                    """,
                    (row["target_user_id"],),
                )
                cursor.execute(
                    """
                    INSERT INTO admin_mfa_challenges (id,challenge_hash,purpose,user_id,expires_at)
                    VALUES (%s,%s,'mfa_reenroll',%s,
                            statement_timestamp()+make_interval(secs => %s))
                    RETURNING expires_at,statement_timestamp() AS db_now
                    """,
                    (challenge_row_id, challenge_hash, row["target_user_id"], self.REENROLL_TTL_SECONDS),
                )
                challenge_row = cursor.fetchone()
                cursor.execute(
                    "UPDATE users SET auth_session_version=auth_session_version+1,updated_at=statement_timestamp() WHERE id=%s",
                    (row["target_user_id"],),
                )
                if cursor.rowcount != 1:
                    raise BreakGlassRequestUnavailable("대상 계정을 찾을 수 없습니다.")
                cursor.execute(
                    "UPDATE admin_mfa_profiles SET profile_version=profile_version+1,updated_at=statement_timestamp() WHERE user_id=%s",
                    (row["target_user_id"],),
                )
                if cursor.rowcount != 1:
                    raise BreakGlassRequestUnavailable("대상 MFA profile을 찾을 수 없습니다.")
                cursor.execute(
                    """
                    UPDATE admin_mfa_break_glass_requests
                    SET status='consumed',consumed_at=statement_timestamp(),result_challenge_id=%s
                    WHERE request_id=%s AND status='pending'
                    """,
                    (challenge_row_id, request_id),
                )
                if cursor.rowcount != 1:
                    raise BreakGlassRequestUnavailable("이미 처리된 복구 요청입니다.")
                self._audit(cursor, target_user_id=row["target_user_id"], request_id=request_id,
                            event="admin.mfa.break_glass.executed", before="pending", after="consumed",
                            correlation_id=row["correlation_id"])
                body = {
                    "requestId": request_id, "challengeId": challenge_id,
                    "purpose": "mfa_reenroll", "expiresAt": self._iso(challenge_row["expires_at"]),
                }
                self._write_owner_only_json(output, body)
                created_output = True
            connection.commit()
        except Exception:
            connection.rollback()
            if created_output:
                output.unlink(missing_ok=True)
            raise
        finally:
            connection.close()
        ttl = max(0, int((challenge_row["expires_at"] - challenge_row["db_now"]).total_seconds()))
        return BreakGlassExecution(request_id=request_id, purpose="mfa_reenroll",
                                   expires_in_seconds=ttl, challenge_output=output)

    def _require_db(self) -> PostgresService:
        if self.db is None:
            raise BreakGlassError("이 명령에는 DB 연결이 필요합니다.")
        return self.db

    def _audit_failure(self, request_id: str, event: str) -> None:
        db = self._require_db()
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT target_user_id,correlation_id,status FROM admin_mfa_break_glass_requests WHERE request_id=%s",
                (request_id,),
            )
            row = cursor.fetchone()
            if row is None:
                return
            self._audit(cursor, target_user_id=row["target_user_id"], request_id=request_id,
                        event=event, before=row["status"], after=row["status"],
                        correlation_id=row["correlation_id"])
            connection.commit()

    def _lock_request(self, cursor, request_id: str):
        cursor.execute(
            """
            SELECT request_id,target_user_id,reason,correlation_id,nonce,status,expires_at,
                   statement_timestamp() AS db_now
            FROM admin_mfa_break_glass_requests WHERE request_id=%s FOR UPDATE
            """,
            (request_id,),
        )
        row = cursor.fetchone()
        if row is None or row["status"] != "pending":
            raise BreakGlassRequestUnavailable("대기 중인 복구 요청을 찾을 수 없습니다.")
        if row["expires_at"] <= row["db_now"]:
            cursor.execute("UPDATE admin_mfa_break_glass_requests SET status='expired' WHERE request_id=%s AND status='pending'", (request_id,))
            self._audit(cursor, target_user_id=row["target_user_id"], request_id=request_id,
                        event="admin.mfa.break_glass.expired", before="pending", after="expired",
                        correlation_id=row["correlation_id"])
            cursor.connection.commit()
            raise BreakGlassRequestUnavailable("복구 요청이 만료되었습니다.")
        return row

    def _artifact_from_row(self, row) -> dict[str, object]:
        return self._request_artifact(request_id=row["request_id"], target_user_id=row["target_user_id"],
                                      reason=row["reason"], correlation_id=row["correlation_id"],
                                      expires_at=row["expires_at"], nonce=bytes(row["nonce"]))

    def _request_artifact(self, *, request_id: str, target_user_id: str, reason: str,
                          correlation_id: str, expires_at: datetime, nonce: bytes) -> dict[str, object]:
        return {
            "version": self.VERSION, "requestId": request_id, "targetUserId": target_user_id,
            "reason": reason,
            "reasonDigest": hashlib.sha256(reason.encode("utf-8")).hexdigest(),
            "correlationId": correlation_id, "expiresAt": self._iso(expires_at),
            "nonce": base64.b64encode(nonce).decode("ascii"),
        }

    def _validate_output_path(self, output: Path) -> None:
        if output == self.repository_root or self.repository_root in output.parents:
            raise ValueError("challenge output은 저장소 밖의 새 파일이어야 합니다.")
        if output.exists():
            raise FileExistsError("challenge output은 기존 파일을 덮어쓸 수 없습니다.")
        if not output.parent.is_dir():
            raise FileNotFoundError("challenge output 상위 폴더가 존재하지 않습니다.")

    @staticmethod
    def _write_owner_only_json(path: Path, payload: Mapping[str, object]) -> None:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
        descriptor = os.open(path, flags, 0o600)
        try:
            os.chmod(path, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                descriptor = -1
                json.dump(payload, stream, ensure_ascii=True, separators=(",", ":"))
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            if os.name == "nt":
                AdminMfaBreakGlassService._restrict_windows_acl(path)
            elif stat.S_IMODE(path.stat().st_mode) & 0o077:
                raise PermissionError("challenge output 권한이 owner-only가 아닙니다.")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            if descriptor >= 0:
                os.close(descriptor)

    @staticmethod
    def _restrict_windows_acl(path: Path) -> None:
        identity = subprocess.run(
            ["whoami", "/user", "/fo", "csv", "/nh"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        fields = next(__import__("csv").reader([identity]))
        if len(fields) < 2 or not fields[1].startswith("S-"):
            raise PermissionError("현재 사용자 SID를 확인할 수 없습니다.")
        sid = fields[1]
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", f"*{sid}:(R,W)"],
            check=True, capture_output=True, text=True,
        )

    @staticmethod
    def write_new_json(path: Path, payload: Mapping[str, object]) -> None:
        AdminMfaBreakGlassService._write_owner_only_json(path.resolve(), payload)

    @staticmethod
    def _audit(cursor, *, target_user_id: str, request_id: str, event: str,
               before: str | None, after: str | None, correlation_id: str,
               approver_id: str | None = None,
               action_reason_digest: str | None = None) -> None:
        cursor.execute("SELECT company_id,name FROM users WHERE id=%s", (target_user_id,))
        target = cursor.fetchone()
        if target is None:
            raise BreakGlassRequestUnavailable("대상 계정을 찾을 수 없습니다.")
        reason = json.dumps({"correlationId": correlation_id, "approverId": approver_id,
                             "actionReasonDigest": action_reason_digest},
                            ensure_ascii=True, separators=(",", ":"))
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id,company_id,actor_user_id,actor_user_name,target_type,target_id,
                event,status_before,status_after,reason,created_at
            ) VALUES (%s,%s,NULL,'offline-custodian','admin_mfa_break_glass',%s,%s,%s,%s,%s,statement_timestamp())
            """,
            (f"audit_{uuid4().hex}", target["company_id"], request_id, event, before, after, reason),
        )
