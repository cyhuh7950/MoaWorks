from __future__ import annotations


class OutboundProviderResolver:
    """신규 외부 발송은 회사의 명시적 활성 설정만 사용한다. 큐 재시도에는 적용하지 않는다."""

    @staticmethod
    def resolve(cursor, company_id: str) -> dict:
        provider = OutboundProviderResolver.optional(cursor, company_id)
        if provider is None:
            raise ValueError("회사의 활성 발송 Provider가 정확히 하나여야 합니다.")
        return provider

    @staticmethod
    def optional(cursor, company_id: str) -> dict | None:
        cursor.execute(
            "SELECT * FROM mail_provider_configs WHERE company_id = %s AND active = TRUE",
            (company_id,),
        )
        rows = cursor.fetchall()
        if len(rows) > 1:
            raise ValueError("회사의 활성 발송 Provider가 정확히 하나여야 합니다.")
        return dict(rows[0]) if rows else None

    @staticmethod
    def readiness(cursor, company_id: str) -> dict | None:
        try:
            return OutboundProviderResolver.resolve(cursor, company_id)
        except ValueError:
            return None

    @staticmethod
    def provider_key(provider: dict) -> str:
        kind = provider['provider_type']
        if kind in ('oci_email_delivery', 'oci_smtp'):
            return 'oci_email_delivery'
        if kind in ('self_hosted', 'self_hosted_smtp', 'smtp'):
            return 'self_hosted'
        raise ValueError("지원하지 않는 발송 Provider입니다.")
