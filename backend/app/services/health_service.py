from pathlib import Path
import os
import socket
import threading
from uuid import uuid4

from app.core.config import settings
from app.schemas.observability import EventEnvelope, MonitoringCategory, SeverityLevel, Visibility
from app.schemas.health import ComponentHealth, HealthResponse
from app.services.directory_store import DirectoryStore
from app.services.observability_service import ObservabilityService


class HealthService:
    def __init__(self) -> None:
        self.directory_store = DirectoryStore()

    def build(self) -> HealthResponse:
        try:
            initialized = self.directory_store.is_initialized()
        except Exception:  # noqa: BLE001
            initialized = False
        components = {
            "app": ComponentHealth(status="ok", message="Core API 응답 가능"),
            "db": self._build_db(),
            "mail": self._build_mail(initialized),
            "storage": self._build_storage(initialized),
        }
        status = "ok"
        if any(component.status == "error" for component in components.values()):
            status = "error"
        elif any(component.status in {"warning", "not_configured"} for component in components.values()):
            status = "warning"
        self._emit_health_status_if_needed(status=status, components=components)
        return HealthResponse(status=status, initialized=initialized, components=components)

    def _emit_health_status_if_needed(self, *, status: str, components: dict[str, ComponentHealth]) -> None:
        request_id = f"req_{uuid4().hex}"

        def _runner() -> None:
            severity = SeverityLevel.INFO
            if status == "error":
                severity = SeverityLevel.CRITICAL
            elif status == "warning":
                severity = SeverityLevel.WARN
            payload = {key: comp.model_dump() for key, comp in components.items()}
            event = EventEnvelope(
                eventId=f"evt_{uuid4().hex}",
                eventType="system.health.changed",
                category=MonitoringCategory.SYSTEM,
                severity=severity,
                resourceType="system_health",
                resourceId="system",
                requestId=request_id,
                dedupKey=f"system.health.changed:{status}",
                title="시스템 상태 변경",
                message=f"시스템 상태가 '{status}'로 변경되었습니다.",
                source="health-service",
                companyId="cmp_default",
                targets=["admin"],
                visibility=Visibility.ADMIN,
                payload=payload,
            )
            if status in {"error", "warning"}:
                event.severity = SeverityLevel.ERROR if status == "error" else SeverityLevel.WARN
                storage_status = components["storage"].status
                if storage_status in {"error", "warning"}:
                    storage_event = EventEnvelope(
                        eventId=f"evt_{uuid4().hex}",
                        eventType="system.storage.warning",
                        category=MonitoringCategory.SYSTEM,
                        severity=SeverityLevel.ERROR if storage_status == "error" else SeverityLevel.WARN,
                        resourceType="storage_path",
                        resourceId=components["storage"].details.get("path", "unknown"),
                        requestId=request_id,
                        dedupKey=f"system.storage.warning:{components['storage'].status}:{components['storage'].details.get('path', 'unknown')}",
                        title="저장소 상태 경고",
                        message=f"스토리지 상태가 '{storage_status}'입니다.",
                        source="health-service",
                        companyId="cmp_default",
                        targets=["admin"],
                        visibility=Visibility.ADMIN,
                        payload={"component": "storage", "health": components["storage"].model_dump()},
                    )
                    ObservabilityService().emit_event(storage_event)
            ObservabilityService().emit_event(event)

        threading.Thread(target=_runner, daemon=True).start()

    def _build_db(self) -> ComponentHealth:
        details = {
            "host": settings.postgres_host,
            "port": str(settings.postgres_port),
            "database": settings.postgres_db,
        }
        try:
            with socket.create_connection((settings.postgres_host, settings.postgres_port), timeout=2):
                return ComponentHealth(
                    status="ok",
                    message="DB 연결 확인 완료",
                    details=details,
                )
        except OSError as exc:
            return ComponentHealth(
                status="error",
                message="DB 연결을 확인할 수 없습니다.",
                details={**details, "reason": str(exc)},
            )

    def _build_mail(self, initialized: bool) -> ComponentHealth:
        if not initialized:
            return ComponentHealth(status="not_configured", message="초기 설정 전입니다.")
        with self.directory_store.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT provider_type, relay_host, relay_port FROM mail_provider_configs ORDER BY updated_at DESC LIMIT 1"
                )
                provider = cursor.fetchone()
        if provider is None:
            return ComponentHealth(status="not_configured", message="메일 설정이 존재하지 않습니다.")
        return ComponentHealth(
            status="ok",
            message="메일 Relay 설정이 PostgreSQL에서 확인되었습니다.",
            details={
                "provider": provider["provider_type"],
                "relay_host": provider["relay_host"],
                "relay_port": str(provider["relay_port"]),
            },
        )

    def _build_storage(self, initialized: bool) -> ComponentHealth:
        path = settings.storage_path
        try:
            path.mkdir(parents=True, exist_ok=True)
            if not os.access(path, os.W_OK):
                raise OSError("저장소 경로에 쓰기 권한이 없습니다.")
        except OSError as exc:
            return ComponentHealth(
                status="error",
                message="저장소 경로를 사용할 수 없습니다.",
                details={"path": str(path), "reason": str(exc)},
            )
        return ComponentHealth(
            status="ok" if initialized else "warning",
            message="저장소 경로 쓰기 가능" if initialized else "저장소 경로 사전 확인 완료",
            details={"path": str(path)},
        )
