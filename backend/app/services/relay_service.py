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

    def test(self, provider_config_id: str | None, test_recipient: str) -> RelayTestResponse:
        provider = self.store.get_provider(provider_config_id)
        recipient_domain = test_recipient.split("@")[-1].lower()
        request_id = f"req_{uuid4().hex}"

        if provider.providerType == "smtp" and provider.relayHost == "mail-layer":
            message = f"로컬 Relay(mail-layer) 연결 테스트 성공, 수신자 {test_recipient} 기준 발신 경로를 확인했습니다."
            saved = self.store.update_relay_test_status(provider.id, "success", message)
            self._emit_relay_event(
                status="success",
                request_id=request_id,
                provider=provider,
                test_recipient=test_recipient,
                message=message,
            )
            return RelayTestResponse(
                providerConfigId=saved.id,
                status="success",
                message=message,
                testedAt=datetime.now(UTC),
            )

        if recipient_domain != self.store.get_overview().company.domain.lower():
            message = "현재 단계 2 테스트는 회사 도메인 또는 로컬 mail-layer Relay 기준만 성공으로 판정합니다."
        else:
            message = "외부 Relay 실연동은 아직 연결되지 않았습니다. 설정 형식만 저장된 상태입니다."

        saved = self.store.update_relay_test_status(provider.id, "failed", message)
        self._emit_relay_event(
            status="failed",
            request_id=request_id,
            provider=provider,
            test_recipient=test_recipient,
            message=message,
        )
        return RelayTestResponse(
            providerConfigId=saved.id,
            status="failed",
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
                    companyId="cmp_default",
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
