from __future__ import annotations

from datetime import UTC, datetime
import json
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
                mail_host, inbound_mx_host, admin_access_mode, admin_allowed_cidrs,
                active_outbound_provider_key, previous_outbound_provider_key,
                provider_switched_at, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, NULL, NULL, %s, %s)
            ON CONFLICT (company_id) DO UPDATE
            SET registered_domain = EXCLUDED.registered_domain,
                mail_domain = EXCLUDED.mail_domain,
                user_host = EXCLUDED.user_host,
                admin_host = EXCLUDED.admin_host,
                mail_host = EXCLUDED.mail_host,
                inbound_mx_host = EXCLUDED.inbound_mx_host,
                admin_access_mode = EXCLUDED.admin_access_mode,
                admin_allowed_cidrs = EXCLUDED.admin_allowed_cidrs,
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
                contract.inbound_mx_host,
                contract.admin_access_mode,
                json.dumps(contract.admin_allowed_cidrs),
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
            SELECT q.id AS queue_id,
                   CASE
                       WHEN p.provider_type IN ('self_hosted', 'self_hosted_smtp') THEN 'self_hosted'
                       ELSE p.provider_type
                   END AS provider_key
            FROM mail_delivery_queue q
            JOIN mail_provider_configs p ON p.id = q.provider_config_id
            WHERE q.company_id = %s
              AND q.status IN ('queued', 'processing', 'retry_pending')
            ORDER BY q.created_at ASC
            """,
            (company_id,),
        )
        plan = plan_provider_switch(
            current_provider=current_provider,
            target_provider=target_provider,
            queued_items=cursor.fetchall(),
        )
        target_types = (
            ("self_hosted", "self_hosted_smtp", "smtp")
            if plan.new_message_provider == "self_hosted"
            else ("oci_email_delivery",)
        )
        cursor.execute(
            """
            SELECT id, delivery_enabled, last_test_status
            FROM mail_provider_configs
            WHERE company_id = %s
              AND provider_type = ANY(%s)
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (company_id, list(target_types)),
        )
        target = cursor.fetchone()
        if target is None:
            raise ValueError("전환할 발신 Provider 설정을 찾을 수 없습니다.")
        if not target.get("delivery_enabled") or target.get("last_test_status") != "success":
            raise ValueError("실제 연결 테스트를 통과하고 활성화된 Provider만 선택할 수 있습니다.")
        now = datetime.now(UTC)
        cursor.execute(
            """
            UPDATE mail_provider_configs
            SET active = (id = %s),
                updated_at = %s
            WHERE company_id = %s
            """,
            (target["id"], now, company_id),
        )
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

    def rollback_outbound_provider(
        self,
        *,
        cursor,
        company_id: str,
        actor_user_id: str,
        actor_user_name: str = "관리자",
    ) -> ProviderSwitchPlan:
        cursor.execute(
            """SELECT active_outbound_provider_key,previous_outbound_provider_key
            FROM mail_domain_settings WHERE company_id=%s""",
            (company_id,),
        )
        state = cursor.fetchone()
        if state is None or not state.get("previous_outbound_provider_key"):
            raise ValueError("되돌릴 이전 발신 Provider가 없습니다.")
        plan = self.switch_outbound_provider(
            cursor=cursor,
            company_id=company_id,
            actor_user_id=actor_user_id,
            current_provider=state["active_outbound_provider_key"],
            target_provider=state["previous_outbound_provider_key"],
            actor_user_name=actor_user_name,
        )
        cursor.execute(
            """INSERT INTO audit_logs (
                id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,
                status_before,status_after,reason,created_at
            ) VALUES (%s,%s,%s,%s,'mail_domain_settings',%s,'mail.outbound_provider.rolled_back',%s,%s,%s,%s)""",
            (
                f"audit_{uuid4().hex}", company_id, actor_user_id, actor_user_name, company_id,
                plan.previous_provider, plan.new_message_provider,
                "관리자가 직전 발신 Provider로 rollback했습니다.", datetime.now(UTC),
            ),
        )
        return plan
