from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from app.schemas.directory import AuthUserSummary
from app.schemas.translation import TranslationPolicyRequest, TranslationReviewActionRequest
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService


DEFAULT_POLICY: dict[str, Any] = {
    "provider": "disabled",
    "enabled": False,
    "cacheEnabled": True,
    "model": "",
    "apiBaseUrl": "",
    "apiKeyConfigured": False,
    "apiKeyMasked": None,
    "timeoutSeconds": 15,
    "maxRetries": 2,
    "rateLimitPerMinute": 60,
    "circuitFailureThreshold": 5,
    "circuitRecoverySeconds": 60,
    "costPerMillionUnits": None,
    "costUnit": "tokens",
}


class TranslationOperationsStore:
    def __init__(self, db=None, security_service: SecurityService | None = None, *, apply_migrations: bool = True) -> None:
        self.db = db or PostgresService()
        self.security = security_service or SecurityService()
        if apply_migrations:
            self.db.ensure_migrations_applied()

    def get_policy(self, company_id: str, *, include_secret: bool = False) -> dict[str, Any]:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT * FROM translation_provider_configs WHERE company_id=%s", (company_id,))
            row = cursor.fetchone()
        if not row:
            return dict(DEFAULT_POLICY, encryptedApiKey="" if include_secret else None)
        encrypted = row.get("encrypted_api_key") or ""
        result = {
            "provider": row["provider_type"],
            "enabled": row["enabled"],
            "cacheEnabled": row["cache_enabled"],
            "model": row["model"],
            "apiBaseUrl": row["api_base_url"],
            "apiKeyConfigured": bool(encrypted),
            "apiKeyMasked": "••••••••" if encrypted else None,
            "timeoutSeconds": row["timeout_seconds"],
            "maxRetries": row["max_retries"],
            "rateLimitPerMinute": row["rate_limit_per_minute"],
            "circuitFailureThreshold": row["circuit_failure_threshold"],
            "circuitRecoverySeconds": row["circuit_recovery_seconds"],
            "costPerMillionUnits": float(row["cost_per_million_units"]) if row.get("cost_per_million_units") is not None else None,
            "costUnit": row["cost_unit"],
        }
        if include_secret:
            result["apiKey"] = self.security.decrypt_secret(encrypted) if encrypted else ""
        return result

    def update_policy(self, actor: AuthUserSummary, payload: TranslationPolicyRequest) -> dict[str, Any]:
        current = self.get_policy(actor.companyId, include_secret=True)
        values = payload.model_dump(exclude_unset=True)
        provider = values.get("provider", current["provider"])
        if provider not in {"disabled", "openai-compatible", "deepl", "cerebras", "groq", "mistral", "openai", "upstage", "gemini", "openrouter", "anthropic", "ollama"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "TRANSLATION_PROVIDER_INVALID", "userMessage": "지원하지 않는 번역 Provider입니다.", "adminMessage": f"unsupported provider: {provider}"},
            )
        api_key_value = payload.apiKey.get_secret_value() if payload.apiKey is not None else current.get("apiKey", "")
        encrypted = self.security.encrypt_secret(api_key_value) if api_key_value else ""
        merged = {
            "provider": provider,
            "enabled": values.get("enabled", current["enabled"]),
            "cacheEnabled": values.get("cacheEnabled", current["cacheEnabled"]),
            "model": values.get("model", current["model"]),
            "apiBaseUrl": values.get("apiBaseUrl", current["apiBaseUrl"]),
            "timeoutSeconds": values.get("timeoutSeconds", current["timeoutSeconds"]),
            "maxRetries": values.get("maxRetries", current["maxRetries"]),
            "rateLimitPerMinute": values.get("rateLimitPerMinute", current["rateLimitPerMinute"]),
            "circuitFailureThreshold": values.get("circuitFailureThreshold", current["circuitFailureThreshold"]),
            "circuitRecoverySeconds": values.get("circuitRecoverySeconds", current["circuitRecoverySeconds"]),
            "costPerMillionUnits": values.get("costPerMillionUnits", current["costPerMillionUnits"]),
            "costUnit": values.get("costUnit", current["costUnit"]),
        }
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO translation_provider_configs (
                    id, company_id, provider_type, model, api_base_url, encrypted_api_key, enabled,
                    cache_enabled, timeout_seconds, max_retries, rate_limit_per_minute,
                    circuit_failure_threshold, circuit_recovery_seconds, cost_per_million_units, cost_unit, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                ON CONFLICT (company_id) DO UPDATE SET
                    provider_type=EXCLUDED.provider_type, model=EXCLUDED.model,
                    api_base_url=EXCLUDED.api_base_url, encrypted_api_key=EXCLUDED.encrypted_api_key,
                    enabled=EXCLUDED.enabled, cache_enabled=EXCLUDED.cache_enabled,
                    timeout_seconds=EXCLUDED.timeout_seconds, max_retries=EXCLUDED.max_retries,
                    rate_limit_per_minute=EXCLUDED.rate_limit_per_minute,
                    circuit_failure_threshold=EXCLUDED.circuit_failure_threshold,
                    circuit_recovery_seconds=EXCLUDED.circuit_recovery_seconds,
                    cost_per_million_units=EXCLUDED.cost_per_million_units, cost_unit=EXCLUDED.cost_unit, updated_at=NOW()
                """,
                (
                    f"trp_{uuid4().hex[:16]}", actor.companyId, merged["provider"], merged["model"],
                    merged["apiBaseUrl"], encrypted, merged["enabled"], merged["cacheEnabled"],
                    merged["timeoutSeconds"], merged["maxRetries"], merged["rateLimitPerMinute"],
                    merged["circuitFailureThreshold"], merged["circuitRecoverySeconds"],
                    merged["costPerMillionUnits"], merged["costUnit"],
                ),
            )
            self._audit(cursor, actor, "translation.policy.updated", "translation-provider", actor.companyId, metadata={"provider": merged["provider"], "enabled": merged["enabled"]})
            connection.commit()
        return self.get_policy(actor.companyId)

    def record_connection_test(self, actor: AuthUserSummary, *, provider: str, success: bool, code: str) -> None:
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._audit(
                cursor, actor, "translation.provider.connection_test", "translation-provider", actor.companyId,
                metadata={"provider": provider, "success": success, "code": code},
            )
            connection.commit()

    def record_model_list(self, actor: AuthUserSummary, *, provider: str, success: bool, code: str, count: int) -> None:
        with self.db.connect() as connection, connection.cursor() as cursor:
            self._audit(
                cursor, actor, "translation.provider.models_list", "translation-provider", actor.companyId,
                metadata={"provider": provider, "success": success, "code": code, "count": count},
            )
            connection.commit()

    def read_cache(self, company_id: str, *, source_hash: str, source_locale: str, target_locale: str, provider: str, model: str) -> dict[str, Any] | None:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT * FROM translation_cache_entries
                   WHERE company_id=%s AND source_hash=%s AND source_locale=%s
                     AND target_locale=%s AND provider_type=%s AND model=%s""",
                (company_id, source_hash, source_locale, target_locale, provider, model),
            )
            row = cursor.fetchone()
        return dict(row) if row else None

    def write_cache(self, company_id: str, *, source_hash: str, source_locale: str, target_locale: str, source_text: str, translated_text: str, provider: str, model: str, metadata: dict[str, Any], estimated_cost: float | None) -> None:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO translation_cache_entries (
                    id, company_id, source_hash, source_locale, target_locale, source_text,
                    translated_text, provider_type, model, usage_metadata, estimated_cost, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,NOW(),NOW())
                ON CONFLICT (company_id, source_hash, source_locale, target_locale, provider_type, model)
                DO UPDATE SET translated_text=EXCLUDED.translated_text, usage_metadata=EXCLUDED.usage_metadata,
                              estimated_cost=EXCLUDED.estimated_cost, updated_at=NOW()
                """,
                (f"trc_{uuid4().hex[:16]}", company_id, source_hash, source_locale, target_locale, source_text, translated_text, provider, model, json.dumps(metadata), estimated_cost),
            )
            connection.commit()

    def create_review(self, actor: AuthUserSummary, *, source_hash: str, source_locale: str, target_locale: str, source_text: str, translated_text: str, provider: str, model: str, estimated_cost: float | None, status_value: str = "pending") -> dict[str, Any]:
        review_id = f"trv_{uuid4().hex[:16]}"
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO translation_review_items (
                       id,company_id,created_by_user_id,source_hash,source_locale,target_locale,source_text,
                       translated_text,provider_type,model,status,estimated_cost,created_at,updated_at
                   ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW()) RETURNING *""",
                (review_id, actor.companyId, actor.userId, source_hash, source_locale, target_locale, source_text, translated_text, provider, model, status_value, estimated_cost),
            )
            row = cursor.fetchone()
            self._review_event(cursor, actor, review_id, "created", None, translated_text)
            self._audit(cursor, actor, "translation.review.created", "translation-review", review_id)
            connection.commit()
        return self._review_view(row)

    def list_reviews(self, actor: AuthUserSummary, *, review_status: str | None = None) -> dict[str, Any]:
        params: list[Any] = [actor.companyId]
        where = "company_id=%s"
        if review_status:
            where += " AND status=%s"
            params.append(review_status)
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(f"SELECT * FROM translation_review_items WHERE {where} ORDER BY updated_at DESC", params)
            rows = cursor.fetchall()
        return {"items": [self._review_view(row) for row in rows], "total": len(rows)}

    def apply_review_action(self, actor: AuthUserSummary, review_id: str, payload: TranslationReviewActionRequest) -> dict[str, Any]:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT * FROM translation_review_items WHERE id=%s AND company_id=%s FOR UPDATE", (review_id, actor.companyId))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "TRANSLATION_REVIEW_NOT_FOUND", "userMessage": "번역 검수 항목을 찾을 수 없습니다.", "adminMessage": "tenant-scoped review not found"})
            before = row["translated_text"]
            if payload.action == "edit":
                cursor.execute("UPDATE translation_review_items SET translated_text=%s,status='edited',updated_at=NOW() WHERE id=%s RETURNING *", (payload.translatedText, review_id))
            elif payload.action == "approve":
                cursor.execute("UPDATE translation_review_items SET status='approved',approved_by_user_id=%s,approved_at=NOW(),updated_at=NOW() WHERE id=%s RETURNING *", (actor.userId, review_id))
            else:
                raise HTTPException(status_code=409, detail={"code": "TRANSLATION_RETRANSLATE_REQUIRED", "userMessage": "재번역은 번역 서비스를 통해 실행해야 합니다.", "adminMessage": "service retranslation required"})
            updated = cursor.fetchone()
            self._review_event(cursor, actor, review_id, payload.action, before, updated["translated_text"])
            self._audit(cursor, actor, f"translation.review.{payload.action}", "translation-review", review_id)
            connection.commit()
        return self._review_view(updated)

    def get_review(self, actor: AuthUserSummary, review_id: str) -> dict[str, Any]:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT * FROM translation_review_items WHERE id=%s AND company_id=%s", (review_id, actor.companyId))
            row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "TRANSLATION_REVIEW_NOT_FOUND", "userMessage": "번역 검수 항목을 찾을 수 없습니다.", "adminMessage": "tenant-scoped review not found"})
        return dict(row)

    def apply_retranslation(self, actor: AuthUserSummary, review_id: str, *, translated_text: str, provider: str, model: str, estimated_cost: float | None) -> dict[str, Any]:
        with self.db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT * FROM translation_review_items WHERE id=%s AND company_id=%s FOR UPDATE", (review_id, actor.companyId))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "TRANSLATION_REVIEW_NOT_FOUND", "userMessage": "번역 검수 항목을 찾을 수 없습니다.", "adminMessage": "tenant-scoped review not found"})
            cursor.execute(
                """UPDATE translation_review_items SET translated_text=%s,provider_type=%s,model=%s,
                          estimated_cost=%s,status='pending',approved_by_user_id=NULL,approved_at=NULL,updated_at=NOW()
                   WHERE id=%s RETURNING *""",
                (translated_text, provider, model, estimated_cost, review_id),
            )
            updated = cursor.fetchone()
            self._review_event(cursor, actor, review_id, "retranslate", row["translated_text"], translated_text, {"provider": provider, "model": model})
            self._audit(cursor, actor, "translation.review.retranslate", "translation-review", review_id)
            connection.commit()
        return self._review_view(updated)

    def _review_event(self, cursor, actor: AuthUserSummary, review_id: str, action: str, before: str | None, after: str | None, metadata: dict[str, Any] | None = None) -> None:
        cursor.execute(
            "INSERT INTO translation_review_events (id,company_id,review_id,actor_user_id,action,before_text,after_text,metadata,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,NOW())",
            (f"tre_{uuid4().hex[:16]}", actor.companyId, review_id, actor.userId, action, before, after, json.dumps(metadata or {})),
        )

    def _audit(self, cursor, actor: AuthUserSummary, event: str, target_type: str, target_id: str, metadata: dict[str, Any] | None = None) -> None:
        cursor.execute(
            """INSERT INTO audit_logs (id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,NULL,%s,NOW())""",
            (f"log_{uuid4().hex[:16]}", actor.companyId, actor.userId, actor.userName, target_type, target_id, event, json.dumps(metadata or {}, ensure_ascii=False)),
        )

    @staticmethod
    def _review_view(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"], "companyId": row["company_id"], "sourceLocale": row["source_locale"],
            "targetLocale": row["target_locale"], "sourceText": row["source_text"], "translatedText": row["translated_text"],
            "provider": row["provider_type"], "model": row["model"], "status": row["status"],
            "estimatedCost": float(row["estimated_cost"]) if row.get("estimated_cost") is not None else None,
            "createdByUserId": row["created_by_user_id"], "approvedByUserId": row.get("approved_by_user_id"),
            "approvedAt": row.get("approved_at"), "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }
