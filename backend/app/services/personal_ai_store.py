from __future__ import annotations

from datetime import UTC, datetime
import json
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.personal_ai import PersonalAiConfigUpdate
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService


DEFAULT_SETUP_SECRET_KEY = "change-this-stage1-secret-key"


class PersonalAiStore:
    def __init__(
        self,
        db=None,
        security_service: SecurityService | None = None,
        *,
        apply_migrations: bool = True,
    ) -> None:
        self.db = db or PostgresService()
        self.security = security_service or SecurityService()
        if apply_migrations:
            self.db.ensure_migrations_applied()

    def get_config(
        self, actor: AuthUserSummary, *, include_secret: bool = False
    ) -> dict[str, Any]:
        row = self._fetch_config_row(actor)
        if not row:
            result = self._empty_view()
            if include_secret:
                result["apiKey"] = ""
            return result

        result = self._view(row)
        if include_secret:
            encrypted = str(row.get("encrypted_api_key") or "")
            result["apiKey"] = (
                self.security.decrypt_secret(encrypted) if encrypted else ""
            )
        return result

    def save_config(
        self, actor: AuthUserSummary, payload: PersonalAiConfigUpdate
    ) -> dict[str, Any]:
        current = self._fetch_config_row(actor)
        current_provider = str(current.get("provider_type") or "") if current else ""
        current_model = str(current.get("model") or "") if current else ""
        current_encrypted = (
            str(current.get("encrypted_api_key") or "") if current else ""
        )
        raw_key = payload.apiKey.get_secret_value() if payload.apiKey is not None else None
        if raw_key is not None:
            self._require_configured_encryption()
            encrypted: str | None = self.security.encrypt_secret(raw_key)
        elif payload.clearApiKey or payload.provider != current_provider:
            encrypted = None
        else:
            encrypted = current_encrypted or None

        changed = (
            current is None
            or payload.provider != current_provider
            or payload.model != current_model
            or raw_key is not None
            or payload.clearApiKey
        )
        connection_status = (
            "untested" if changed else str(current.get("connection_status") or "untested")
        )
        last_test_code = None if changed else current.get("last_test_code")
        last_tested_at = None if changed else current.get("last_tested_at")

        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO personal_ai_configs (
                    id, company_id, user_id, provider_type, model,
                    encrypted_api_key, connection_status, last_test_code,
                    last_tested_at, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                ON CONFLICT (company_id, user_id) DO UPDATE SET
                    provider_type=EXCLUDED.provider_type,
                    model=EXCLUDED.model,
                    encrypted_api_key=EXCLUDED.encrypted_api_key,
                    connection_status=EXCLUDED.connection_status,
                    last_test_code=EXCLUDED.last_test_code,
                    last_tested_at=EXCLUDED.last_tested_at,
                    updated_at=NOW()
                """,
                (
                    f"pai_{uuid4().hex[:16]}",
                    actor.companyId,
                    actor.userId,
                    payload.provider,
                    payload.model,
                    encrypted,
                    connection_status,
                    last_test_code,
                    last_tested_at,
                ),
            )
            self._audit(
                cursor,
                actor,
                event="personal_ai.config.updated",
                metadata={"provider": payload.provider},
            )
            connection.commit()

        return {
            "provider": payload.provider,
            "model": payload.model,
            "apiKeyConfigured": bool(encrypted),
            "connectionStatus": connection_status,
            "lastTestCode": last_test_code,
            "lastTestedAt": last_tested_at,
        }

    def record_test(
        self, actor: AuthUserSummary, success: bool, code: str
    ) -> None:
        connection_status = "ready" if success else "error"
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE personal_ai_configs
                   SET connection_status=%s, last_test_code=%s,
                       last_tested_at=NOW(), updated_at=NOW()
                 WHERE company_id=%s AND user_id=%s
                 RETURNING provider_type
                """,
                (connection_status, code, actor.companyId, actor.userId),
            )
            row = cursor.fetchone()
            provider = str(row.get("provider_type") or "") if row else ""
            self._audit(
                cursor,
                actor,
                event="personal_ai.connection.tested",
                metadata={"provider": provider, "code": code, "success": success},
            )
            connection.commit()

    def acquire_rate_limit(
        self,
        actor: AuthUserSummary,
        action: str,
        limit: int,
        now: datetime | None = None,
    ) -> int:
        if action not in {"test", "chat"} or limit < 1:
            raise ValueError("invalid personal AI rate limit")
        current = (now or datetime.now(UTC)).astimezone(UTC)
        window_started_at = current.replace(second=0, microsecond=0)
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO personal_ai_rate_limits (
                    company_id, user_id, action, window_started_at, request_count
                ) VALUES (%s,%s,%s,%s,1)
                ON CONFLICT (company_id, user_id, action, window_started_at)
                DO UPDATE SET request_count=personal_ai_rate_limits.request_count + 1
                RETURNING request_count
                """,
                (actor.companyId, actor.userId, action, window_started_at),
            )
            row = cursor.fetchone()
            count = int(row["request_count"]) if row else limit + 1
            connection.commit()
        if count > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "PERSONAL_AI_RATE_LIMITED",
                    "userMessage": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
                    "adminMessage": "personal AI user rate limit exceeded",
                },
            )
        return count

    def _fetch_config_row(self, actor: AuthUserSummary) -> dict[str, Any] | None:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT * FROM personal_ai_configs
                 WHERE company_id=%s AND user_id=%s
                """,
                (actor.companyId, actor.userId),
            )
            row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def _empty_view() -> dict[str, Any]:
        return {
            "provider": "",
            "model": "",
            "apiKeyConfigured": False,
            "connectionStatus": "unconfigured",
            "lastTestCode": None,
            "lastTestedAt": None,
        }

    @staticmethod
    def _view(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "provider": str(row.get("provider_type") or ""),
            "model": str(row.get("model") or ""),
            "apiKeyConfigured": bool(row.get("encrypted_api_key")),
            "connectionStatus": str(row.get("connection_status") or "unconfigured"),
            "lastTestCode": row.get("last_test_code"),
            "lastTestedAt": row.get("last_tested_at"),
        }

    @staticmethod
    def _require_configured_encryption() -> None:
        configured = settings.setup_secret_key.strip()
        if not configured or configured == DEFAULT_SETUP_SECRET_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "PERSONAL_AI_ENCRYPTION_NOT_CONFIGURED",
                    "userMessage": "개인 AI 보안 설정이 준비되지 않았습니다.",
                    "adminMessage": "personal AI encryption is not configured",
                },
            )

    @staticmethod
    def _audit(
        cursor,
        actor: AuthUserSummary,
        *,
        event: str,
        metadata: dict[str, object],
    ) -> None:
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name,
                target_type, target_id, event,
                status_before, status_after, reason, created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,NULL,%s,NOW())
            """,
            (
                f"log_{uuid4().hex[:16]}",
                actor.companyId,
                actor.userId,
                actor.userName,
                "personal-ai-config",
                actor.userId,
                event,
                json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
            ),
        )
