import threading
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas.directory import RelayTestResponse
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.services.directory_store import DirectoryStore
from app.services.observability_service import ObservabilityService


class RelayService:
    def __init__(self, store: DirectoryStore) -> None:
        self.store = store

    def test(self, provider_config_id: str | None, test_recipient: str, *, company_id: str) -> RelayTestResponse:
        provider = self.store.get_provider(provider_config_id, company_id=company_id)
        # 레거시 문자열 판정은 연결 증거가 아니다. 저장된 검증/발송 잠금은 변경하지 않는다.
        message = "미검증: 레거시 Relay 시험은 지원하지 않습니다. 메일 설정의 Provider 연결 검증을 사용하세요. 메일은 전송하지 않았습니다."
        return RelayTestResponse(
            providerConfigId=provider.id,
            status="untested",
            message=message,
            testedAt=datetime.now(UTC),
        )

    def _emit_relay_event(
        self,
        *,
        status: str,
        request_id: str,
        provider,
        test_recipient: str,
        message: str,
    ) -> None:
        def _runner() -> None:
            try:
                payload = {
                    "status": status,
                    "providerId": provider.id,
                    "providerType": provider.providerType,
                    "relayHost": provider.relayHost,
                    "relayPort": provider.relayPort,
                    "recipient": test_recipient,
                }
                event = EventEnvelope(
                    eventId=f"evt_{uuid4().hex}",
                    eventType="mail.relay.test.result" if status == "success" else "mail.relay.fail",
                    category=MonitoringCategory.MAIL,
                    severity=SeverityLevel.INFO if status == "success" else SeverityLevel.WARN,
                    resourceType="mail_provider_config",
                    resourceId=provider.id,
                    requestId=request_id,
                    dedupKey=f"mail.relay:{provider.id}:{status}",
                    title="메일 Relay 테스트 결과",
                    message=message,
                    source="relay-service",
                    companyId=provider.companyId,
                    targets=[],
                    visibility=Visibility.ADMIN,
                    payload=payload,
                )
                ObservabilityService().emit_event(event)
            except Exception as exc:
                print(
                    "observability.relay_emit_failed",
                    provider.id,
                    status,
                    str(exc),
                )

        threading.Thread(target=_runner, daemon=True).start()
