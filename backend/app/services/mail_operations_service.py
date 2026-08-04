from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.services.mail_operations_policy import (
    MailDomainContract,
    ProviderSwitchPlan,
    plan_provider_switch,
)


class MailOperationsService:
    def save_domain_contract(
        self,
        *,
        cursor,
        company_id: str,
        contract: MailDomainContract,
        active_provider: str,
    ) -> None:
        validated_provider = plan_provider_switch(
            current_provider=active_provider,
            target_provider=active_provider,
            queued_items=[],
        ).new_message_provider
        now = datetime.now(UTC)
        cursor.execute(
            """
            INSERT INTO mail_domain_settings (
                company_id, registered_domain, mail_domain, user_host, admin_host,
                mail_host, admin_access_mode, admin_allowed_cidrs,
                active_outbound_provider_key, previous_outbound_provider_key,
                provider_switched_at, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, '[]'::jsonb, %s, NULL, NULL, %s, %s)
            ON CONFLICT (company_id) DO UPDATE
            SET registered_domain = EXCLUDED.registered_domain,
                mail_domain = EXCLUDED.mail_domain,
                user_host = EXCLUDED.user_host,
                admin_host = EXCLUDED.admin_host,
                mail_host = EXCLUDED.mail_host,
                admin_access_mode = EXCLUDED.admin_access_mode,
                active_outbound_provider_key = EXCLUDED.active_outbound_provider_key,
                updated_at = EXCLUDED.updated_at
            """,
            (
                company_id,
                contract.registered_domain,
                contract.mail_domain,
                contract.user_host,
                contract.admin_host,
                contract.mail_host,
                contract.admin_access_mode,
                validated_provider,
                now,
                now,
            ),
        )

    def switch_outbound_provider(
        self,
        *,
        cursor,
        company_id: str,
        actor_user_id: str,
        current_provider: str,
        target_provider: str,
        actor_user_name: str = "관리자",
    ) -> ProviderSwitchPlan:
        cursor.execute(
            """
            SELECT id AS queue_id, provider_key
            FROM mail_delivery_queue
            WHERE company_id = %s
              AND status IN ('queued', 'sending', 'retry_pending')
            ORDER BY created_at ASC
            """,
            (company_id,),
        )
        plan = plan_provider_switch(
            current_provider=current_provider,
            target_provider=target_provider,
            queued_items=cursor.fetchall(),
        )
        now = datetime.now(UTC)
        cursor.execute(
            """
            UPDATE mail_domain_settings
            SET previous_outbound_provider_key = active_outbound_provider_key,
                active_outbound_provider_key = %s,
                provider_switched_at = %s,
                updated_at = %s
            WHERE company_id = %s
              AND active_outbound_provider_key = %s
            """,
            (
                plan.new_message_provider,
                now,
                now,
                company_id,
                plan.previous_provider,
            ),
        )
        cursor.execute(
            """
            INSERT INTO audit_logs (
                id, company_id, actor_user_id, actor_user_name, target_type,
                target_id, event, status_before, status_after, reason, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                f"audit_{uuid4().hex}",
                company_id,
                actor_user_id,
                actor_user_name,
                "mail_domain_settings",
                company_id,
                "mail.outbound_provider.switched",
                plan.previous_provider,
                plan.new_message_provider,
                "기존 발송 큐의 Provider를 유지하고 신규 발송 Provider를 전환했습니다.",
                now,
            ),
        )
        return plan
